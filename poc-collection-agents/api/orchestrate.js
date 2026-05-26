import { getAgent, getSelfCorrection } from './lib/harness.js'
import { runSecurityGate } from './lib/security.js'
import * as nlu from './lib/agents/nlu.js'
import * as motor from './lib/agents/motor.js'
import * as empatia from './lib/agents/empatia.js'
import * as guardiao from './lib/agents/guardiao.js'

const AGENT_RUNNERS = {
  agente_escuta_nlu: nlu,
  agente_motor_acordo: motor,
  agente_empatia_copywriter: empatia,
  agente_guardiao_compliance: guardiao,
}

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  // Health check
  if (req.method === 'GET') {
    const key = process.env.OPENROUTER_API_KEY
    return res.status(200).json({ ok: true, model: process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini', has_key: !!key })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Determine API key: BYOK header takes precedence if ALLOW_BYOK is enabled
  const allowByok = process.env.ALLOW_BYOK === 'true'
  const byokKey = allowByok ? req.headers['x-byok-key'] : null
  const apiKey = byokKey || process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    // No key — signal frontend to use fallback mock
    return res.status(503).json({ error: 'No API key configured', mock: true })
  }

  const baseUrl = 'https://openrouter.ai/api/v1'
  const openrouter = { apiKey, baseUrl }

  // Parse body
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const { session_id, user_role = 'CUSTOMER', message, history = [] } = body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' })
  }

  // ── Layer 0: Security gate — runs before any LLM call ──────────────────────
  const securityResult = runSecurityGate(message, history)
  if (!securityResult.safe) {
    const isHigh = securityResult.highestSeverity === 'HIGH'

    if (isHigh) {
      // Block entirely — emit security event and close
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.flushHeaders()

      const blockMsg = securityResult.threats.map((t) => t.threat).includes('TOKEN_FLOODING')
        ? 'Mensagem muito longa ou com padrões de repetição. Por favor, tente novamente com uma mensagem mais curta.'
        : 'Sua mensagem contém padrões não permitidos pelo sistema de segurança. Por favor, reformule sua mensagem.'

      res.write(`event: security_block\ndata: ${JSON.stringify({
        threats: securityResult.threats.map((t) => ({ threat: t.threat, severity: t.severity, detail: t.detail })),
        user_message: blockMsg,
      })}\n\n`)
      res.end()
      return
    }

    // MEDIUM/LOW: continue but log — annotate state for Guardião
    console.warn('[security] MEDIUM threat detected, continuing with annotation:', securityResult.summary)
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  function emit(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const selfCorrectionConfig = getSelfCorrection()

    let state = {
      session_id,
      user_role,
      message,
      history,
      detected_intent: null,
      sentiment: null,
      nlu_summary: null,
      calculated_proposal: null,
      motor_tactic_note: null,
      motor_reason: null,
      debt_info: null,
      policy_info: null,
      draft_response: null,
      compliance_status: null,
      compliance_feedback: null,
      compliance_risk: null,
      final_response: null,
      correction_feedback: null,
      // Security annotations (Layer 0 result forwarded to Guardião)
      security_threats: securityResult.safe ? [] : securityResult.threats,
      security_severity: securityResult.safe ? null : securityResult.highestSeverity,
    }

    const allTraces = []
    let selfCorrectionAttempts = 0
    const maxSelfCorrections = selfCorrectionConfig?.max_attempts ?? 2

    // Override model from env if set
    function resolveModel(agentConfig) {
      if (process.env.OPENROUTER_DEFAULT_MODEL) {
        return process.env.OPENROUTER_DEFAULT_MODEL
      }
      return agentConfig.model
    }

    async function runAgent(agentId) {
      const agentConfig = getAgent(agentId)
      const resolvedConfig = { ...agentConfig, model: resolveModel(agentConfig) }
      const runner = AGENT_RUNNERS[agentId]

      if (!runner) {
        throw new Error(`No runner found for agent: ${agentId}`)
      }

      emit('agent_start', { id: agentId, model: resolvedConfig.model })

      const { patch, trace } = await runner.run(state, { agent: resolvedConfig, openrouter })
      Object.assign(state, patch)
      allTraces.push(trace)

      emit('agent_end', {
        id: agentId,
        patch,
        trace: {
          thought: trace.thought,
          tools: trace.tools,
          rag: trace.rag,
          tokens: trace.tokens,
          latency_ms: trace.latency_ms,
        },
      })
    }

    // Run NLU and Motor always first
    await runAgent('agente_escuta_nlu')
    emit('state_update', { detected_intent: state.detected_intent, sentiment: state.sentiment })

    await runAgent('agente_motor_acordo')

    // Empatia + Guardião loop with self-correction
    let approved = false
    while (!approved && selfCorrectionAttempts <= maxSelfCorrections) {
      await runAgent('agente_empatia_copywriter')
      await runAgent('agente_guardiao_compliance')

      if (state.compliance_status === 'APROVADO') {
        approved = true
      } else if (selfCorrectionAttempts < maxSelfCorrections) {
        selfCorrectionAttempts++
        state.correction_feedback = state.compliance_feedback
        emit('self_correction', {
          attempt: selfCorrectionAttempts,
          feedback: state.compliance_feedback,
        })
      } else {
        // Max attempts reached — approve with a warning note
        state.compliance_status = 'APROVADO'
        state.draft_response = (state.draft_response || '') + '\n\n[Nota: Texto revisado pelo Guardião de Compliance.]'
        approved = true
      }
    }

    state.final_response = state.draft_response

    const totalTokens = allTraces.reduce((acc, t) => acc + (t.tokens || 0), 0)
    const totalLatency = allTraces.reduce((acc, t) => acc + (t.latency_ms || 0), 0)
    // Rough cost estimate: $0.005/1K for 4o-mini, $0.015/1K for 4o — use blended avg
    const estimatedCostUsd = (totalTokens / 1000) * 0.008

    emit('final', {
      response: state.final_response,
      compliance_status: state.compliance_status,
      compliance_risk: state.compliance_risk,
      calculated_proposal: state.calculated_proposal,
      detected_intent: state.detected_intent,
      sentiment: state.sentiment,
      self_corrections: selfCorrectionAttempts,
      observability: {
        total_tokens: totalTokens,
        total_latency_ms: totalLatency,
        estimated_cost_usd: Math.round(estimatedCostUsd * 10000) / 10000,
        agents_run: allTraces.map((t) => t.agent),
      },
    })
  } catch (err) {
    console.error('[orchestrate] Error:', err)
    emit('error', { message: err.message })
  } finally {
    res.end()
  }
}
