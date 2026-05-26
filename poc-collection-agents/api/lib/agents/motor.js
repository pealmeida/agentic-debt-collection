import { callOpenRouter, parseJSON } from '../openrouter.js'
import { getDebtStatus, getDiscountPolicy, calculateAmortization } from '../tools.js'

const DEBT_ID = 'D-9982'

/**
 * Agente Motor de Acordo
 * Reads debt data and discount policies (via MCP tools), then calculates a concrete proposal.
 * If the intent signals legal threat, it defers proposal calculation and flags for de-escalation.
 */
export async function run(state, { agent, openrouter }) {
  const { detected_intent, sentiment, nlu_summary, history = [], message } = state
  const toolCalls = []
  const ragContext = []

  // Always fetch debt status
  const debtResult = getDebtStatus(DEBT_ID)
  toolCalls.push({ name: 'get_debt_status', payload: JSON.stringify({ debt_id: DEBT_ID }), status: 200 })
  ragContext.push({ source: debtResult.source, snippet: debtResult.snippet })
  const debt = debtResult.result

  // Fetch applicable discount policy
  const policyResult = getDiscountPolicy(debt.days_overdue)
  toolCalls.push({ name: 'get_politicas_desconto', payload: JSON.stringify({ days_overdue: debt.days_overdue }), status: 200 })
  ragContext.push({ source: policyResult.source, snippet: policyResult.snippet })
  const policy = policyResult.result

  const contextForLLM = JSON.stringify({
    debt,
    applicable_policy: policy,
    detected_intent,
    sentiment,
    message_summary: nlu_summary || message,
  })

  const { content, usage, latencyMs } = await callOpenRouter({
    model: agent.model,
    temperature: agent.temperature ?? 0.0,
    system: agent.system_prompt,
    messages: [
      { role: 'user', content: `Contexto:\n${contextForLLM}\n\nCalcule a proposta ideal ou indique por que não é possível.` },
    ],
    responseFormat: {
      type: 'json_schema',
      json_schema: {
        name: 'motor_output',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            can_propose: { type: 'boolean' },
            reason_if_not: { type: 'string' },
            proposal: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                discount_rate: { type: 'number' },
                desconto: { type: 'string' },
                installments: { type: 'number' },
                installment_value: { type: 'number' },
              },
              required: ['total', 'discount_rate', 'desconto', 'installments', 'installment_value'],
              additionalProperties: false,
            },
            tactic_note: { type: 'string', description: 'Nota interna para o Agente Empatia' },
          },
          required: ['can_propose', 'reason_if_not', 'proposal', 'tactic_note'],
          additionalProperties: false,
        },
      },
    },
    apiKey: openrouter.apiKey,
    baseUrl: openrouter.baseUrl,
  })

  const parsed = parseJSON(content, {
    can_propose: true,
    reason_if_not: '',
    proposal: calculateAmortization({ principal: debt.total_amount, discount: policy.max_discount, installments: 3 }).result,
    tactic_note: '',
  })

  // If LLM says we can propose, also run the amortization tool to confirm math
  if (parsed.can_propose && parsed.proposal) {
    const amortResult = calculateAmortization({
      principal: debt.total_amount,
      discount: parsed.proposal.discount_rate || policy.max_discount,
      installments: parsed.proposal.installments || 3,
    })
    toolCalls.push({
      name: 'calculate_amortization',
      payload: JSON.stringify({ principal: debt.total_amount, discount: policy.max_discount }),
      status: 200,
    })
    ragContext.push({ source: amortResult.source, snippet: amortResult.snippet })
    // Trust the tool math over LLM arithmetic
    parsed.proposal = { ...parsed.proposal, ...amortResult.result }
  }

  const thought = parsed.can_propose
    ? `Proposta calculada: R$ ${parsed.proposal?.total} (${parsed.proposal?.desconto} off) em ${parsed.proposal?.installments}x. ${parsed.tactic_note}`
    : `Proposta bloqueada: ${parsed.reason_if_not}`

  return {
    patch: {
      calculated_proposal: parsed.can_propose ? parsed.proposal : null,
      motor_tactic_note: parsed.tactic_note,
      motor_reason: parsed.reason_if_not,
      debt_info: debt,
      policy_info: policy,
    },
    trace: {
      agent: 'agente_motor_acordo',
      thought,
      tools: toolCalls,
      rag: ragContext,
      tokens: usage.total_tokens,
      latency_ms: latencyMs,
    },
  }
}
