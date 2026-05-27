import { callOpenRouter, parseJSON } from '../openrouter.js'
import { getDebtStatus, getDiscountPolicy, calculateAmortization } from '../tools.js'
import { lastAgentText, parseProposalFromText, countPriorOffers, tieredDiscount } from '../conversation.js'

const MOTOR_SCHEMA = {
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
}

/**
 * Agente Motor de Acordo
 * Reads debt data and discount policies (via MCP tools), then calculates a concrete proposal.
 * If the intent signals legal threat, it defers proposal calculation and flags for de-escalation.
 *
 * GP-12: never trusts LLM arithmetic — `calculateAmortization()` is the source of truth.
 */
export async function run(state, { agent, openrouter }) {
  const { detected_intent, sentiment, nlu_summary, message, debt_data, history = [] } = state
  const toolCalls = []
  const ragContext = []

  // Recover the proposal already offered in the conversation so a follow-up
  // (acceptance / promise to pay) confirms the SAME numbers instead of silently
  // re-deriving a fresh default. Keeps the agreement consistent across turns.
  const previousAgentText = lastAgentText(history)
  const previousProposal = parseProposalFromText(previousAgentText)
  const isAcceptance = /acei[tç]|fechad|combinad|de acordo|pagamento/i.test(detected_intent || '')
  const isPromise = /promessa|adiament|futur/i.test(detected_intent || '')

  // How many concrete offers were already shown in this conversation. Drives the
  // two-tier negotiation ladder: open small to attract, concede more to retain.
  const priorOfferCount = countPriorOffers(history)

  const debtResult = getDebtStatus(debt_data)
  toolCalls.push({
    name: 'get_debt_status',
    payload: JSON.stringify({ debt_id: debt_data?.debt_id || null, provided: !!debt_data }),
    status: debtResult.result ? 200 : 422,
  })
  ragContext.push({ source: debtResult.source, snippet: debtResult.snippet })
  const debt = debtResult.result

  if (!debt) {
    const reason = 'Sem contexto de dívida válido do CRM/request. Não é possível calcular proposta sem total_amount e days_overdue.'
    return {
      patch: {
        calculated_proposal: null,
        motor_tactic_note: 'Solicite ou selecione um caso CRM com valor total, dias em atraso e produto antes de negociar.',
        motor_reason: reason,
        debt_info: null,
        policy_info: null,
      },
      trace: {
        agent: 'agente_motor_acordo',
        thought: `Proposta bloqueada: ${reason}`,
        tools: toolCalls,
        rag: ragContext,
        tokens: 0,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        latency_ms: 0,
      },
    }
  }

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
    previous_proposal: previousProposal,
    last_agent_message: previousAgentText ? previousAgentText.slice(0, 400) : null,
  })

  const { content, usage, latencyMs } = await callOpenRouter({
    model: agent.model,
    temperature: agent.temperature ?? 0.0,
    system: agent.system_prompt,
    messages: [
      { role: 'user', content: `Contexto:\n${contextForLLM}\n\nCalcule a proposta ideal ou indique por que não é possível.` },
    ],
    schema: MOTOR_SCHEMA,
    schemaName: 'motor_output',
    jsonStrategy: agent.json_strategy,
    promptHints: agent.prompt_hints,
    apiKey: openrouter.apiKey,
    baseUrl: openrouter.baseUrl,
  })

  const parsed = parseJSON(content, {
    can_propose: true,
    reason_if_not: '',
    proposal: calculateAmortization({ principal: debt.total_amount, discount: policy.max_discount, installments: 3 }).result,
    tactic_note: '',
  })

  // If LLM says we can propose, recompute math with hard safety bounds.
  // GP-12: never trust LLM arithmetic; clamp discount rate to alçada max.
  if (parsed.can_propose && parsed.proposal) {
    // On acceptance / promise, the customer is responding to a proposal already
    // on the table — honor those exact terms (GP: consistency across the
    // conversation) rather than whatever the LLM re-derived this turn.
    const carryForward = (isAcceptance || isPromise) && previousProposal
    // Derive the prior discount from its total — but only trust it when it lands
    // in a sane band. A "discount" of ~0 means we parsed the *original* amount by
    // mistake (the offer text often mentions R$ 1.200 before the discounted R$ 840),
    // so fall back to the policy/LLM rate instead of confirming a 0%-off deal.
    const derivedDiscount = carryForward && previousProposal.total != null
      ? 1 - previousProposal.total / debt.total_amount
      : null
    const prevDiscount = derivedDiscount != null && derivedDiscount > 0.01 ? derivedDiscount : null

    // Two-tier discount ladder (anchored on the full price). The alçada max is
    // the *final* concession, never the opening bid: lead with a smaller
    // discount to attract, then escalate to the ceiling on a follow-up turn so
    // we don't lose the deal. Installments stay flexible (chosen above).
    const ceiling = policy.max_discount
    const ladderDiscount = tieredDiscount(priorOfferCount, ceiling)

    const rawDiscount = prevDiscount ?? ladderDiscount
    const safeDiscount = Math.max(0, Math.min(rawDiscount, policy.max_discount))
    const wasClamped = rawDiscount > policy.max_discount

    toolCalls.push({
      name: 'negotiation:discount_tier',
      payload: JSON.stringify({
        stage: prevDiscount ? 'carry_forward' : priorOfferCount === 0 ? 'tier1_attract' : 'tier2_retain',
        prior_offers: priorOfferCount,
        ceiling,
        applied: safeDiscount,
      }),
      status: 200,
    })

    const rawInstallments = carryForward && previousProposal.installments
      ? previousProposal.installments
      : Math.round(Number(parsed.proposal.installments)) || 3
    const safeInstallments = Math.max(1, Math.min(rawInstallments, 12))

    const amortResult = calculateAmortization({
      principal: debt.total_amount,
      discount: safeDiscount,
      installments: safeInstallments,
    })

    toolCalls.push({
      name: 'calculate_amortization',
      payload: JSON.stringify({ principal: debt.total_amount, discount: safeDiscount, installments: safeInstallments, clamped: wasClamped }),
      status: 200,
    })
    ragContext.push({ source: amortResult.source, snippet: amortResult.snippet })

    if (wasClamped) {
      toolCalls.push({
        name: 'security:discount_clamped',
        payload: JSON.stringify({ requested: rawDiscount, applied: policy.max_discount, policy: policy.label }),
        status: 200,
      })
    }

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
      usage,
      latency_ms: latencyMs,
    },
  }
}
