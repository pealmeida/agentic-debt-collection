/**
 * Shared frontend utilities — formatters, session helpers, derived state.
 */

import { AGENT_ID_MAP } from './constants.js'

export function formatTime(ts) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

/**
 * Monotonic message-id generator. Replaces `Date.now()` / `Date.now() + 1`,
 * which can collide when a user message and the AI reply (or two rapid turns)
 * land in the same millisecond — producing duplicate React keys and breaking
 * `latestAIMessageId` (a Math.max over ids). A simple incrementing counter is
 * always unique and strictly increasing, so "latest" ordering still holds.
 */
let _messageIdSeq = 0
export function nextMessageId() {
  return ++_messageIdSeq
}

export function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem('poc_session_id')
    if (!id) {
      id = `sess_${Math.random().toString(36).slice(2, 11)}`
      sessionStorage.setItem('poc_session_id', id)
    }
    return id
  } catch {
    return `sess_${Math.random().toString(36).slice(2, 11)}`
  }
}

export function saveObservabilityEntry(entry) {
  try {
    const raw = sessionStorage.getItem('poc_observability') || '[]'
    const entries = JSON.parse(raw)
    entries.unshift({ ...entry, ts: Date.now() })
    sessionStorage.setItem('poc_observability', JSON.stringify(entries.slice(0, 50)))
  } catch { /* ignore */ }
}

/**
 * Derive UI status (active/completed/success) for a pipeline step from agentState.
 * Used by both the desktop pipeline list and the mobile mini-bar.
 */
export function getStepStatus(stepId, agentState) {
  const { activeAgent, detectedIntent, calculatedProposal, complianceStatus } = agentState
  const shortId = AGENT_ID_MAP[stepId] || stepId
  switch (shortId) {
    case 'escuta':
      return { active: activeAgent === 'escuta', completed: !!detectedIntent, success: !!detectedIntent }
    case 'motor':
      return {
        active: activeAgent === 'motor',
        completed: !!calculatedProposal || activeAgent === 'empatia' || activeAgent === 'guardiao' || !!complianceStatus,
        success: !!calculatedProposal || !!complianceStatus,
      }
    case 'empatia':
      return {
        active: activeAgent === 'empatia',
        completed: activeAgent === 'guardiao' || !!complianceStatus,
        success: true,
      }
    case 'guardiao':
      return {
        active: activeAgent === 'guardiao',
        completed: !!complianceStatus,
        success: complianceStatus === 'APROVADO',
      }
    default:
      return { active: false, completed: false, success: false }
  }
}

/** Download an arbitrary JSON object as a file. Used for trace export. */
export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
