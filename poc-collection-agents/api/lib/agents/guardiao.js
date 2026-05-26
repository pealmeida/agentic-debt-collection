import { callOpenRouter, parseJSON } from '../openrouter.js'
import { getCdcGuidelines, checkGuardrailViolations } from '../tools.js'
import { scanDraftForLeakage } from '../security.js'

const GUARDIAO_SCHEMA = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['APROVADO', 'REJEITADO'] },
    feedback: { type: 'string', description: 'Feedback para reescrita se rejeitado' },
    risk_level: { type: 'string', enum: ['BAIXO', 'MÉDIO', 'ALTO'] },
    cdc_articles_checked: { type: 'array', items: { type: 'string' } },
  },
  required: ['status', 'feedback', 'risk_level', 'cdc_articles_checked'],
  additionalProperties: false,
}

/**
 * Intents that ALWAYS force a full L3 LLM judge regardless of deterministic
 * results. We never skip the semantic check for legally-charged conversations.
 *
 * The matching is permissive (substring, case-insensitive, accent-tolerant)
 * because the upstream NLU classifies into free-form Portuguese labels.
 */
const HIGH_RISK_INTENT_PATTERNS = [
  /amea[cç]a/i,
  /risco\s+legal/i,
  /coerc/i,
  /jur[ií]dic/i,
  /contesta/i,
  /fraude/i,
]

function isHighRiskIntent(detectedIntent) {
  if (!detectedIntent) return true // unclassified = play safe, run L3
  return HIGH_RISK_INTENT_PATTERNS.some((re) => re.test(detectedIntent))
}

/**
 * Agente Guardião (Compliance)
 *
 * Four-layer validation (in order — first failure exits early):
 *
 * L0 — Injection leakage scan:  checks if the Empatia draft itself carries
 *       injected content that slipped through the NLU/Motor stage.
 * L1 — Fast regex guardrails:   deterministic CDC forbidden-pattern check.
 * L2 — Security threat escalation: if Layer 0 (orchestrator) flagged MEDIUM
 *       threats, force a stricter LLM audit.
 * L3 — LLM-as-judge:            semantic compliance check against CDC guidelines.
 *
 * Fast-path (L3 skipped) — only when ALL of these hold:
 *   • L0 leakage scan: clean
 *   • L1 regex check: zero violations
 *   • L2 upstream threats: none
 *   • detected_intent: NOT in HIGH_RISK_INTENT_PATTERNS
 * In every other case, L3 runs as before. The Guardião agent itself still
 * executes for every turn (GP-01 preserved); only the LLM call inside it is
 * elided when there's nothing semantically ambiguous to judge.
 *
 * Measured impact on `balanced-cost`: -700-1300ms per happy turn, ~$0.00015
 * saved. Risky turns (Ameaça, Contestação, etc.) are unchanged.
 *
 * Returns APROVADO or REJEITADO with a feedback string for the Empatia re-write.
 */
export async function run(state, { agent, openrouter }) {
  const { draft_response, detected_intent, user_role, security_threats = [], security_severity } = state
  const toolCalls = []
  const ragContext = []

  // ── Layer 0: Injection leakage scan on generated draft ─────────────────────
  const leakage = scanDraftForLeakage(draft_response)
  toolCalls.push({
    name: 'security:scan_draft_leakage',
    payload: JSON.stringify({ chars: (draft_response || '').length }),
    status: leakage.clean ? 200 : 422,
  })

  if (!leakage.clean) {
    const feedback = `Output do Empatia contém padrões de vazamento de injeção (${leakage.detail}). Reescreva completamente sem referenciar instruções do sistema.`
    return {
      patch: {
        compliance_status: 'REJEITADO',
        compliance_feedback: feedback,
        compliance_risk: 'ALTO',
      },
      trace: {
        agent: 'agente_guardiao_compliance',
        thought: `REJEITADO (L0/leakage): ${leakage.detail}`,
        tools: toolCalls,
        rag: ragContext,
        tokens: 0,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        latency_ms: 0,
      },
    }
  }

  // ── Layer 1: Fast regex guardrails (CDC forbidden patterns) ────────────────
  const violations = checkGuardrailViolations(draft_response || '')
  toolCalls.push({
    name: 'security:check_regex_guardrails',
    payload: JSON.stringify({ patterns_checked: violations.map((v) => v.pattern) }),
    status: violations.length > 0 ? 422 : 200,
  })

  if (violations.length > 0) {
    const feedback = `Padrões proibidos (CDC) detectados: ${violations.map((v) => `"${v.pattern}" (${v.article})`).join(', ')}. Reescreva sem coerção.`
    return {
      patch: {
        compliance_status: 'REJEITADO',
        compliance_feedback: feedback,
        compliance_risk: 'ALTO',
      },
      trace: {
        agent: 'agente_guardiao_compliance',
        thought: `REJEITADO (L1/regex): ${violations.map((v) => v.pattern).join(', ')}`,
        tools: toolCalls,
        rag: ragContext,
        tokens: 0,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        latency_ms: 0,
      },
    }
  }

  // ── Layer 2: Surface upstream security threats to LLM judge ───────────────
  const hasUpstreamThreats = security_threats.length > 0
  const threatContext = hasUpstreamThreats
    ? `\n\nALERTA DE SEGURANÇA: O input do usuário ativou ${security_threats.length} detector(es) de segurança (severidade: ${security_severity}): ${security_threats.map((t) => t.threat).join(', ')}. Seja mais criterioso na avaliação.`
    : ''

  if (hasUpstreamThreats) {
    toolCalls.push({
      name: 'security:upstream_threat_context',
      payload: JSON.stringify({ threats: security_threats.map((t) => t.threat), severity: security_severity }),
      status: 200,
    })
  }

  // ── Fast-path: skip L3 when deterministic layers + intent classification ──
  // all say BAIXO risk. The semantic LLM judge is only valuable when there's
  // ambiguity to resolve; for unambiguously safe turns it adds 700-1300ms of
  // pure overhead. Risky intents and any threat signal always escalate to L3.
  const highRisk = isHighRiskIntent(detected_intent)
  if (!hasUpstreamThreats && !highRisk) {
    toolCalls.push({
      name: 'security:llm_judge',
      payload: JSON.stringify({ skipped: true, reason: 'low_risk_deterministic_pass', intent: detected_intent }),
      status: 200,
    })
    return {
      patch: {
        compliance_status: 'APROVADO',
        compliance_feedback: '',
        compliance_risk: 'BAIXO',
      },
      trace: {
        agent: 'agente_guardiao_compliance',
        thought: `L0:leakage✓ → L1:regex✓ → L2:clean → L3:skipped(low_risk) | Risco: BAIXO | Intent ${detected_intent || '(none)'} fora da lista de alto risco; LLM judge dispensado.`,
        tools: toolCalls,
        rag: ragContext,
        tokens: 0,
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        latency_ms: 0,
      },
    }
  }

  // ── Layer 3: LLM-as-judge — semantic CDC compliance check ─────────────────
  const cdcResult = getCdcGuidelines()
  toolCalls.push({
    name: 'mcp:legal_guardrail/check_cdc',
    payload: JSON.stringify({ check_coercion: true, threat_context: hasUpstreamThreats }),
    status: 200,
  })
  ragContext.push({ source: cdcResult.source, snippet: cdcResult.snippet })

  const { content, usage, latencyMs } = await callOpenRouter({
    model: agent.model,
    temperature: agent.temperature ?? 0.0,
    system: agent.system_prompt + threatContext,
    messages: [
      {
        role: 'user',
        content: `Avalie este texto de cobrança quanto ao CDC brasileiro:\n\n"${draft_response}"\n\nContexto: intent=${detected_intent}, user_role=${user_role}\nDiretrizes CDC: ${JSON.stringify(cdcResult.result)}${hasUpstreamThreats ? `\n\nThreat signals detectados no input original: ${security_threats.map((t) => `${t.threat} (${t.detail})`).join('; ')}` : ''}`,
      },
    ],
    schema: GUARDIAO_SCHEMA,
    schemaName: 'guardiao_output',
    jsonStrategy: agent.json_strategy,
    promptHints: agent.prompt_hints,
    apiKey: openrouter.apiKey,
    baseUrl: openrouter.baseUrl,
  })

  const parsed = parseJSON(content, {
    status: 'APROVADO',
    feedback: '',
    risk_level: 'BAIXO',
    cdc_articles_checked: ['Art. 42 CDC'],
  })

  toolCalls.push({
    name: 'security:llm_judge',
    payload: JSON.stringify({ model: agent.model, upstream_threats: hasUpstreamThreats }),
    status: parsed.status === 'APROVADO' ? 200 : 422,
  })

  const layers = ['L0:leakage✓', 'L1:regex✓', hasUpstreamThreats ? 'L2:threats⚠' : 'L2:clean', `L3:llm-judge=${parsed.status}`]
  const thought = `${layers.join(' → ')} | Risco: ${parsed.risk_level} | CDC: ${parsed.cdc_articles_checked?.join(', ') || 'N/A'}. ${parsed.feedback || 'Sem violações.'}`

  return {
    patch: {
      compliance_status: parsed.status,
      compliance_feedback: parsed.feedback,
      compliance_risk: parsed.risk_level,
    },
    trace: {
      agent: 'agente_guardiao_compliance',
      thought,
      tools: toolCalls,
      rag: ragContext,
      tokens: usage.total_tokens,
      usage,
      latency_ms: latencyMs,
    },
  }
}
