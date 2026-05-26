/**
 * Orchestrator service — connects the frontend to /api/orchestrate via SSE.
 *
 * If the backend is unavailable (no API key, network error, or 503 with mock=true),
 * falls back to a rich local simulation that exercises every feature:
 *   - Security gate (jailbreak, prompt injection, token flooding)
 *   - Scenario detection (acceptance, threat, unemployment, more installments, etc.)
 *   - Self-correction loop visualization
 *   - Realistic token/latency/cost numbers
 *   - Multi-turn context awareness
 */

import { runSecurityGate } from '../shared/security.js'
import { detectScenario, buildScenarioOutput, simAgentMetrics } from './fallback-scenarios.js'

const DEBT_INFO_FULL = {
  debtor_name: 'João da Silva',
  cpf_masked: '***.***.123-**',
  total_amount: 1200.0,
  days_overdue: 45,
  product: 'Crédito Pessoal',
  status: 'OVERDUE',
}

/**
 * Async generator that streams pipeline events from the backend.
 * Each yielded event: { type: string, data: object }
 */
export async function* runPipeline(message, { sessionId, userRole, history = [] }) {
  let res
  try {
    res = await fetch('/api/orchestrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, user_role: userRole, message, history }),
    })
  } catch (networkErr) {
    yield { type: 'fallback', data: { reason: 'network_error' } }
    yield* runLocalFallback(message, userRole, history)
    return
  }

  if (!res.ok) {
    let body = {}
    const contentType = res.headers.get('content-type') || ''
    const isJson = contentType.includes('application/json')
    if (isJson) {
      try {
        body = await res.json()
      } catch {
        /* ignore */
      }
    }

    // No backend (Vite dev 404), no API key (503 mock), or explicit mock flag → local simulation
    const useFallback =
      body.mock === true ||
      res.status === 404 ||
      res.status === 502 ||
      (!isJson && res.status >= 400)

    if (useFallback) {
      yield {
        type: 'fallback',
        data: { reason: body.mock ? 'no_api_key' : res.status === 404 ? 'no_backend' : 'backend_unavailable' },
      }
      yield* runLocalFallback(message, userRole, history)
      return
    }

    yield { type: 'error', data: { message: body.error || `HTTP ${res.status}` } }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete line

    let currentEvent = null
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6))
          yield { type: currentEvent, data }
        } catch { /* malformed JSON — skip */ }
        currentEvent = null
      }
    }
  }
}

/**
 * Human-readable threat label for UI display.
 */
export function formatSecurityThreat(threat) {
  const labels = {
    TOKEN_FLOODING: 'Limite de tamanho / repetição excessiva',
    PROMPT_INJECTION: 'Tentativa de injeção de prompt',
    JAILBREAK_ATTEMPT: 'Tentativa de jailbreak',
    INJECTION_LEAKAGE: 'Vazamento de injeção no output',
  }
  return labels[threat] || threat
}

// ─── Local fallback simulation ───────────────────────────────────────────────

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** Mirror of the backend pipeline, fully simulated. */
async function* runLocalFallback(message, userRole, history = []) {
  // ── Layer 0: Security gate (same module as the backend) ────────────────────
  const securityResult = runSecurityGate(message, history)

  if (!securityResult.safe && securityResult.highestSeverity === 'HIGH') {
    // Brief delay so the user sees something happen
    await delay(300)

    const isFlood = securityResult.threats.some((t) => t.threat === 'TOKEN_FLOODING')
    const blockMsg = isFlood
      ? 'Mensagem muito longa ou com padrões de repetição. Por favor, tente novamente com uma mensagem mais curta.'
      : 'Sua mensagem contém padrões não permitidos pelo sistema de segurança. Por favor, reformule sua mensagem.'

    yield {
      type: 'security_block',
      data: {
        threats: securityResult.threats.map((t) => ({
          threat: t.threat,
          severity: t.severity,
          detail: t.detail,
        })),
        user_message: blockMsg,
        simulated: true,
      },
    }
    return
  }

  // ── Detect scenario for this turn ──────────────────────────────────────────
  const scenarioMatch = detectScenario(message, history)
  const scenario = buildScenarioOutput(scenarioMatch, userRole)

  // Cumulative metrics for the final observability payload
  let totalTokens = 0
  let totalLatency = 0

  // ── Agent 1: NLU ───────────────────────────────────────────────────────────
  const nluMetrics = simAgentMetrics('nlu')
  totalTokens += nluMetrics.tokens
  totalLatency += nluMetrics.latency_ms

  yield { type: 'agent_start', data: { id: 'agente_escuta_nlu', model: 'mock' } }
  await delay(Math.min(nluMetrics.latency_ms, 1000))

  yield {
    type: 'agent_end',
    data: {
      id: 'agente_escuta_nlu',
      patch: { detected_intent: scenario.intent, sentiment: scenario.sentiment },
      trace: {
        thought: `[SIM] ${scenario.nluThought}`,
        tools: [],
        rag: [],
        tokens: nluMetrics.tokens,
        latency_ms: nluMetrics.latency_ms,
      },
    },
  }
  yield { type: 'state_update', data: { detected_intent: scenario.intent, sentiment: scenario.sentiment } }

  // ── Agent 2: Motor de Acordo ──────────────────────────────────────────────
  const motorMetrics = simAgentMetrics('motor')
  totalTokens += motorMetrics.tokens
  totalLatency += motorMetrics.latency_ms

  yield { type: 'agent_start', data: { id: 'agente_motor_acordo', model: 'mock' } }
  await delay(Math.min(motorMetrics.latency_ms, 1200))

  yield {
    type: 'agent_end',
    data: {
      id: 'agente_motor_acordo',
      patch: {
        calculated_proposal: scenario.proposal,
        debt_info: DEBT_INFO_FULL,
      },
      trace: {
        thought: `[SIM] ${scenario.motorThought}`,
        tools: scenario.motorTools,
        rag: scenario.motorRag,
        tokens: motorMetrics.tokens,
        latency_ms: motorMetrics.latency_ms,
      },
    },
  }

  // ── Agents 3+4: Empatia → Guardião (with optional self-correction) ────────
  let selfCorrections = 0
  const shouldSelfCorrect = scenario.triggerSelfCorrection

  // First pass
  yield* runEmpatiaGuardiaoPass({
    scenario,
    userRole,
    isFirstPass: true,
    forceReject: shouldSelfCorrect,
    metricsAccumulator: (t, l) => { totalTokens += t; totalLatency += l },
  })

  if (shouldSelfCorrect) {
    selfCorrections++
    yield {
      type: 'self_correction',
      data: {
        attempt: 1,
        feedback: 'Tom levemente defensivo detectado. Reescrevendo com mais empatia (Self-Correction Loop).',
      },
    }
    await delay(400)

    // Second pass — now approved
    yield* runEmpatiaGuardiaoPass({
      scenario,
      userRole,
      isFirstPass: false,
      forceReject: false,
      metricsAccumulator: (t, l) => { totalTokens += t; totalLatency += l },
    })
  }

  // ── Final emission ─────────────────────────────────────────────────────────
  const estimatedCostUsd = (totalTokens / 1000) * 0.008

  yield {
    type: 'final',
    data: {
      response: scenario.response,
      compliance_status: scenario.complianceStatus,
      compliance_risk: scenario.complianceRisk,
      calculated_proposal: scenario.proposal,
      detected_intent: scenario.intent,
      sentiment: scenario.sentiment,
      self_corrections: selfCorrections,
      observability: {
        total_tokens: totalTokens,
        total_latency_ms: totalLatency,
        estimated_cost_usd: Math.round(estimatedCostUsd * 10000) / 10000,
        agents_run: ['agente_escuta_nlu', 'agente_motor_acordo', 'agente_empatia_copywriter', 'agente_guardiao_compliance'],
        mode: 'simulation',
        scenario_id: scenario.id,
      },
    },
  }
}

async function* runEmpatiaGuardiaoPass({ scenario, userRole, isFirstPass, forceReject, metricsAccumulator }) {
  // Empatia
  const empMetrics = simAgentMetrics('empatia')
  metricsAccumulator(empMetrics.tokens, empMetrics.latency_ms)

  yield { type: 'agent_start', data: { id: 'agente_empatia_copywriter', model: 'mock' } }
  await delay(Math.min(empMetrics.latency_ms, 900))

  yield {
    type: 'agent_end',
    data: {
      id: 'agente_empatia_copywriter',
      patch: {
        draft_response: isFirstPass && forceReject
          ? `${scenario.response}\n\n[SIM: versão inicial marcada para reescrita pelo Guardião.]`
          : scenario.response,
      },
      trace: {
        thought: isFirstPass
          ? `[SIM] ${scenario.empatiaThought}`
          : `[SIM] Reescrevendo após feedback do Guardião — tom mais empático e neutro.`,
        tools: [],
        rag: [],
        tokens: empMetrics.tokens,
        latency_ms: empMetrics.latency_ms,
      },
    },
  }

  // Guardião
  const gMetrics = simAgentMetrics('guardiao')
  metricsAccumulator(gMetrics.tokens, gMetrics.latency_ms)

  yield { type: 'agent_start', data: { id: 'agente_guardiao_compliance', model: 'mock' } }
  await delay(Math.min(gMetrics.latency_ms, 1000))

  if (forceReject) {
    yield {
      type: 'agent_end',
      data: {
        id: 'agente_guardiao_compliance',
        patch: {
          compliance_status: 'REJEITADO',
          compliance_feedback: 'Tom levemente defensivo detectado. Reescreva com mais empatia e neutralidade.',
          compliance_risk: 'MÉDIO',
        },
        trace: {
          thought: '[SIM] L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=REJEITADO | Tom defensivo detectado. Disparando self-correction.',
          tools: [
            { name: 'security:scan_draft_leakage', payload: '{ chars: 245 }', status: 200 },
            { name: 'security:check_regex_guardrails', payload: '{}', status: 200 },
            { name: 'security:llm_judge', payload: '{ model: "mock" }', status: 422 },
          ],
          rag: scenario.guardiaoRag,
          tokens: gMetrics.tokens,
          latency_ms: gMetrics.latency_ms,
        },
      },
    }
  } else {
    yield {
      type: 'agent_end',
      data: {
        id: 'agente_guardiao_compliance',
        patch: {
          compliance_status: scenario.complianceStatus,
          compliance_feedback: '',
          compliance_risk: scenario.complianceRisk,
        },
        trace: {
          thought: `[SIM] ${scenario.guardiaoThought}`,
          tools: [
            { name: 'security:scan_draft_leakage', payload: '{ chars: 245 }', status: 200 },
            { name: 'security:check_regex_guardrails', payload: '{}', status: 200 },
            { name: 'security:llm_judge', payload: '{ model: "mock" }', status: 200 },
          ],
          rag: scenario.guardiaoRag,
          tokens: gMetrics.tokens,
          latency_ms: gMetrics.latency_ms,
        },
      },
    }
  }
}
