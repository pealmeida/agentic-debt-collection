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
  const { setAgentState, setMessages, addLog, updateInspector, stepIndexRef } = ctx

  switch (type) {
    case 'fallback':
      setAgentState((prev) => ({ ...prev, isFallback: true }))
      addLog('warn', `[Sistema] Modo simulação: ${data.reason === 'no_api_key' ? 'sem chave OpenRouter' : 'sem conexão'}`)
      break

    case 'agent_start': {
      const shortId = AGENT_ID_MAP[data.id] || data.id
      setAgentState((prev) => ({ ...prev, activeAgent: shortId }))
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

      if (patch) {
        setAgentState((prev) => ({
          ...prev,
          ...(patch.detected_intent ? { detectedIntent: patch.detected_intent, sentiment: patch.sentiment } : {}),
          ...(patch.calculated_proposal !== undefined ? { calculatedProposal: patch.calculated_proposal } : {}),
          ...(patch.compliance_status ? { complianceStatus: patch.compliance_status } : {}),
          ...(patch.debt_info ? { debtInfo: patch.debt_info } : {}),
        }))
      }

      if (trace) {
        if (trace.thought) {
          updateInspector('thinking', { step: stepIndexRef.current, text: trace.thought })
          const preview = trace.thought.length > 80 ? `${trace.thought.slice(0, 80)}...` : trace.thought
          addLog('info', `[${shortId}] ${preview}`)
        }
        trace.tools?.forEach((t) => updateInspector('tools', t))
        trace.rag?.forEach((r) => updateInspector('ragContext', r))
      }
      break
    }

    case 'self_correction':
      addLog('warn', `[Guardião] Self-correction #${data.attempt}: "${data.feedback?.slice(0, 60)}..."`)
      updateInspector('thinking', {
        step: stepIndexRef.current + 0.5,
        text: `Self-correction ativada: ${data.feedback}`,
      })
      break

    case 'final': {
      const { response, compliance_status, calculated_proposal, detected_intent, sentiment, observability, self_corrections } = data

      setAgentState((prev) => ({
        ...prev,
        activeAgent: null,
        complianceStatus: compliance_status,
        calculatedProposal: calculated_proposal || prev.calculatedProposal,
        detectedIntent: detected_intent || prev.detectedIntent,
        sentiment: sentiment || prev.sentiment,
        lastObservability: observability,
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
        sentiment,
        total_tokens: observability?.total_tokens || 0,
        total_latency_ms: observability?.total_latency_ms || 0,
        estimated_cost_usd: observability?.estimated_cost_usd || 0,
        self_corrections: self_corrections || 0,
        mode: observability?.mode || 'real',
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
