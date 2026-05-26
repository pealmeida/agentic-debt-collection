import { resolveAgent, getSelfCorrection, getActiveProfile, estimateCostUsd } from './lib/harness.js'
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

function sendOptions(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  return res.status(204).end()
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendOptions(res)
  }

  // Health check (lightweight echo of the main healthz, keeps backward compat).
  if (req.method === 'GET') {
    const profile = getActiveProfile()
    return res.status(200).json({
      ok: true,
      profile: profile ? { id: profile.id, label: profile.label } : null,
      has_key: !!process.env.OPENROUTER_API_KEY,
    })
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    return res.status(503).json({ error: 'No OpenRouter API key configured', mock: true })
  }

  const profile = getActiveProfile()
  const baseUrl = profile?.base_url || 'https://openrouter.ai/api/v1'
  const openrouter = { apiKey, baseUrl }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' })
  }

  const { session_id, user_role = 'CUSTOMER', message, history = [], debt_data = null } = body

  if (!message?.trim()) {
    return res.status(400).json({ error: 'message is required' })
  }

  // ── Layer 0: Security gate — runs before any LLM call ──────────────────────
  const securityResult = runSecurityGate(message, history)
  if (!securityResult.safe) {
    const isHigh = securityResult.highestSeverity === 'HIGH'

    if (isHigh) {
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

    console.warn('[security] MEDIUM threat detected, continuing with annotation:', securityResult.summary)
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  function emit(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  // Surface the active profile to the UI at the start of each session.
  emit('profile', {
    id: profile?.id || null,
    label: profile?.label || null,
    description: profile?.description || null,
    env_override: !!process.env.OPENROUTER_DEFAULT_MODEL,
  })

  try {
    const selfCorrectionConfig = getSelfCorrection()

    let state = {
      session_id,
      user_role,
      message,
      history,
      debt_data,
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
      security_threats: securityResult.safe ? [] : securityResult.threats,
      security_severity: securityResult.safe ? null : securityResult.highestSeverity,
    }

    const allTraces = []
    let totalCostUsd = 0
    let selfCorrectionAttempts = 0
    const maxSelfCorrections = selfCorrectionConfig?.max_attempts ?? 2

    async function runAgent(agentId) {
      const resolved = resolveAgent(agentId)
      const runner = AGENT_RUNNERS[agentId]

      if (!runner) {
        throw new Error(`No runner found for agent: ${agentId}`)
      }

      emit('agent_start', {
        id: agentId,
        model: resolved.model,
        json_strategy: resolved.json_strategy,
        prompt_hints: resolved.prompt_hints,
        profile_id: resolved.profile_id,
      })

      const { patch, trace } = await runner.run(state, { agent: resolved, openrouter })
      Object.assign(state, patch)

      // Per-agent cost using profile pricing (with safe fallback).
      const agentCostUsd = estimateCostUsd(resolved, trace.usage)
      totalCostUsd += agentCostUsd
      allTraces.push({ ...trace, cost_usd: agentCostUsd, model: resolved.model })

      emit('agent_end', {
        id: agentId,
        model: resolved.model,
        patch,
        trace: {
          thought: trace.thought,
          tools: trace.tools,
          rag: trace.rag,
          tokens: trace.tokens,
          usage: trace.usage,
          latency_ms: trace.latency_ms,
          cost_usd: Number(agentCostUsd.toFixed(6)),
        },
      })
    }

    await runAgent('agente_escuta_nlu')
    emit('state_update', { detected_intent: state.detected_intent, sentiment: state.sentiment })

    await runAgent('agente_motor_acordo')

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
        state.compliance_status = 'APROVADO'
        state.draft_response = (state.draft_response || '') + '\n\n[Nota: Texto revisado pelo Guardião de Compliance.]'
        approved = true
      }
    }

    state.final_response = state.draft_response

    const totalTokens = allTraces.reduce((acc, t) => acc + (t.tokens || 0), 0)
    const totalLatency = allTraces.reduce((acc, t) => acc + (t.latency_ms || 0), 0)

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
        estimated_cost_usd: Math.round(totalCostUsd * 1_000_000) / 1_000_000,
        agents_run: allTraces.map((t) => t.agent),
        profile_id: profile?.id || null,
        profile_label: profile?.label || null,
      },
    })
  } catch (err) {
    console.error('[orchestrate] Error:', err)
    emit('error', { message: err.message })
  } finally {
    res.end()
  }
}
