/**
 * Pipeline event handler — translates SSE events from the orchestrator
 * into state updates and side-effect calls.
 *
 * Encapsulates the long event-loop switch that used to live inside
 * `handleSendMessage` in App.jsx.
 */

import { AGENT_ID_MAP } from '../constants.js'
import { saveObservabilityEntry } from '../utils.js'
import { formatSecurityThreat } from './orchestrator.js'

function snapshotTurnTrace(turnTraceRef) {
  if (!turnTraceRef?.current) return null
  return {
    ...turnTraceRef.current,
    agents: [...(turnTraceRef.current.agents || [])],
    self_corrections: [...(turnTraceRef.current.self_corrections || [])],
    drafts: [...(turnTraceRef.current.drafts || [])],
  }
}

function publishTurnTrace(setAgentState, turnTraceRef) {
  const workflowTrace = snapshotTurnTrace(turnTraceRef)
  if (!workflowTrace) return
  setAgentState((prev) => ({ ...prev, workflowTrace }))
}

function ensureTurnTrace(turnTraceRef) {
  if (!turnTraceRef) return null
  if (!turnTraceRef.current) {
    turnTraceRef.current = {
      started_at: new Date().toISOString(),
      agents: [],
      self_corrections: [],
      drafts: [],
    }
  }
  turnTraceRef.current.agents ||= []
  turnTraceRef.current.self_corrections ||= []
  turnTraceRef.current.drafts ||= []
  return turnTraceRef.current
}

/**
 * Apply a single pipeline event to the React state via callback handlers.
 *
 * @param {object} event              { type, data }
 * @param {object} ctx                Handlers + counters provided by App.jsx
 * @param {function} ctx.setAgentState
 * @param {function} ctx.setMessages
 * @param {function} ctx.addLog
 * @param {function} ctx.updateInspector
 * @param {{ current: number }} ctx.stepIndexRef
 */
export function applyPipelineEvent(event, ctx) {
  const { type, data } = event
  const { setAgentState, setMessages, addLog, updateInspector, stepIndexRef, turnTraceRef } = ctx

  switch (type) {
    case 'fallback':
      ensureTurnTrace(turnTraceRef)
      if (turnTraceRef?.current) {
        turnTraceRef.current.mode = 'simulation'
        turnTraceRef.current.fallback_reason = data.reason
      }
      setAgentState((prev) => ({ ...prev, isFallback: true }))
      addLog('warn', `[Sistema] Modo simulação: ${
        data.reason === 'no_api_key'
          ? 'sem chave OpenRouter no servidor'
          : data.reason === 'no_backend'
            ? 'backend /api indisponível'
            : 'sem conexão'
      }`)
      break

    case 'profile':
      ensureTurnTrace(turnTraceRef)
      if (turnTraceRef?.current) {
        turnTraceRef.current.profile = data
        publishTurnTrace(setAgentState, turnTraceRef)
      }
      break

    case 'agent_start': {
      const shortId = AGENT_ID_MAP[data.id] || data.id
      const turnTrace = ensureTurnTrace(turnTraceRef)
      if (turnTrace) {
        turnTrace.agents.push({
          id: data.id,
          short_id: shortId,
          model: data.model,
          profile_id: data.profile_id,
          json_strategy: data.json_strategy,
          prompt_hints: data.prompt_hints,
          started_at: new Date().toISOString(),
          status: 'running',
        })
        turnTrace.active_agent_index = turnTrace.agents.length - 1
      }
      setAgentState((prev) => ({ ...prev, activeAgent: shortId }))
      publishTurnTrace(setAgentState, turnTraceRef)
      addLog('info', `[${data.id}] Iniciando${data.model !== 'mock' ? ` (${data.model})` : ''}...`)
      break
    }

    case 'state_update':
      setAgentState((prev) => ({
        ...prev,
        detectedIntent: data.detected_intent || prev.detectedIntent,
        sentiment: data.sentiment || prev.sentiment,
      }))
      break

    case 'agent_end': {
      const { id, patch, trace } = data
      const shortId = AGENT_ID_MAP[id] || id
      stepIndexRef.current++
      const turnTrace = ensureTurnTrace(turnTraceRef)
      const runIndex = turnTrace
        ? [...turnTrace.agents].map((agent, index) => ({ agent, index })).reverse().find(({ agent }) => agent.id === id && agent.status === 'running')?.index
        : -1
      const normalizedTrace = trace ? {
        thought: trace.thought,
        tools: trace.tools || [],
        rag: trace.rag || [],
        tokens: trace.tokens || 0,
        usage: trace.usage || null,
        latency_ms: trace.latency_ms || 0,
        cost_usd: trace.cost_usd || 0,
      } : null

      if (turnTrace && runIndex >= 0) {
        turnTrace.agents[runIndex] = {
          ...turnTrace.agents[runIndex],
          ended_at: new Date().toISOString(),
          status: 'completed',
          patch: patch || {},
          trace: normalizedTrace,
        }
      }

      if (turnTrace && patch?.draft_response) {
        turnTrace.drafts.push({
          agent: id,
          attempt: turnTrace.drafts.length + 1,
          text: patch.draft_response,
          ts: new Date().toISOString(),
        })
      }

      if (patch) {
        setAgentState((prev) => ({
          ...prev,
          ...(patch.detected_intent ? { detectedIntent: patch.detected_intent, sentiment: patch.sentiment } : {}),
          ...(patch.calculated_proposal !== undefined ? { calculatedProposal: patch.calculated_proposal } : {}),
          ...(patch.compliance_status ? { complianceStatus: patch.compliance_status } : {}),
          ...(patch.compliance_risk ? { complianceRisk: patch.compliance_risk } : {}),
          ...(patch.compliance_feedback !== undefined ? { complianceFeedback: patch.compliance_feedback } : {}),
          ...(patch.draft_response !== undefined ? { draftResponse: patch.draft_response } : {}),
          ...(patch.debt_info ? { debtInfo: patch.debt_info } : {}),
        }))
      }

      if (trace) {
        if (trace.thought) {
          updateInspector('thinking', {
            step: stepIndexRef.current,
            agent: id,
            agentShort: shortId,
            model: data.model,
            text: trace.thought,
            tokens: trace.tokens || 0,
            latency_ms: trace.latency_ms || 0,
            cost_usd: trace.cost_usd || 0,
          })
          const preview = trace.thought.length > 80 ? `${trace.thought.slice(0, 80)}...` : trace.thought
          addLog('info', `[${shortId}] ${preview}`)
        }
        trace.tools?.forEach((t) => updateInspector('tools', { ...t, agent: id, agentShort: shortId, step: stepIndexRef.current }))
        trace.rag?.forEach((r) => updateInspector('ragContext', { ...r, agent: id, agentShort: shortId, step: stepIndexRef.current }))
      }
      publishTurnTrace(setAgentState, turnTraceRef)
      break
    }

    case 'self_correction':
      ensureTurnTrace(turnTraceRef)
      if (turnTraceRef?.current) {
        turnTraceRef.current.self_corrections.push({
          attempt: data.attempt,
          feedback: data.feedback,
          ts: new Date().toISOString(),
        })
      }
      addLog('warn', `[Guardião] Self-correction #${data.attempt}: "${data.feedback?.slice(0, 60)}..."`)
      updateInspector('thinking', {
        step: stepIndexRef.current + 0.5,
        agent: 'state_graph.self_correction',
        agentShort: 'self-correction',
        text: `Self-correction ativada: ${data.feedback}`,
        tokens: 0,
        latency_ms: 0,
        cost_usd: 0,
      })
      publishTurnTrace(setAgentState, turnTraceRef)
      break

    case 'final': {
      const { response, compliance_status, calculated_proposal, detected_intent, sentiment, observability, self_corrections } = data
      ensureTurnTrace(turnTraceRef)
      if (turnTraceRef?.current) {
        turnTraceRef.current.ended_at = new Date().toISOString()
        turnTraceRef.current.final_response = response
        turnTraceRef.current.final_state = {
          compliance_status,
          compliance_risk: data.compliance_risk,
          calculated_proposal,
          detected_intent,
          sentiment,
        }
        turnTraceRef.current.observability = observability
      }
      const workflowTrace = snapshotTurnTrace(turnTraceRef)
      const drafts = workflowTrace?.drafts || []

      setAgentState((prev) => ({
        ...prev,
        activeAgent: null,
        complianceStatus: compliance_status,
        complianceRisk: data.compliance_risk || prev.complianceRisk,
        calculatedProposal: calculated_proposal || prev.calculatedProposal,
        detectedIntent: detected_intent || prev.detectedIntent,
        sentiment: sentiment || prev.sentiment,
        finalResponse: response,
        lastObservability: observability,
        workflowTrace,
      }))

      addLog(
        'success',
        `[Guardião] Output liberado (${compliance_status}). Tokens: ${observability?.total_tokens || 0}, Latência: ${observability?.total_latency_ms || 0}ms`,
      )

      if (self_corrections > 0) {
        addLog('warn', `[Pipeline] ${self_corrections} self-correction(s) realizada(s).`)
      }

      saveObservabilityEntry({
        intent: detected_intent,
        compliance_status,
        compliance_risk: data.compliance_risk,
        sentiment,
        total_tokens: observability?.total_tokens || 0,
        total_latency_ms: observability?.total_latency_ms || 0,
        estimated_cost_usd: observability?.estimated_cost_usd || 0,
        self_corrections: self_corrections || 0,
        mode: observability?.mode || 'real',
        profile_id: observability?.profile_id,
        scenario_id: observability?.scenario_id,
        agents_run: workflowTrace?.agents?.map((agent) => ({
          id: agent.id,
          model: agent.model,
          tokens: agent.trace?.tokens || 0,
          latency_ms: agent.trace?.latency_ms || 0,
          cost_usd: agent.trace?.cost_usd || 0,
          tools_count: agent.trace?.tools?.length || 0,
          rag_count: agent.trace?.rag?.length || 0,
          status: agent.patch?.compliance_status || agent.status,
        })) || observability?.agents_run || [],
        draft_response: drafts[drafts.length - 1]?.text || null,
        final_response: response,
        calculated_proposal,
        workflow_trace: workflowTrace,
      })

      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'ai', ts: Date.now() + 1, text: response }])
      break
    }

    case 'security_block': {
      const threatLabels = (data.threats || []).map((t) => formatSecurityThreat(t.threat)).join(', ')
      addLog('error', `[Segurança] Mensagem bloqueada: ${threatLabels}`)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'ai',
          ts: Date.now() + 1,
          text: data.user_message || 'Sua mensagem foi bloqueada pelo sistema de segurança.',
          isSecurityBlock: true,
        },
      ])
      break
    }

    case 'error':
      addLog('error', `[Pipeline] Erro: ${data.message}`)
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'ai',
          ts: Date.now() + 1,
          text: 'Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.',
        },
      ])
      break

    default:
      // Unknown event types are ignored to allow forward compatibility
      break
  }
}
