import { callOpenRouter } from '../openrouter.js'

/**
 * Agente Empatia (Copywriter)
 * Translates the motor's mathematical output into human-readable text.
 * Adapts format and tone based on user_role (CUSTOMER = WhatsApp empático,
 * AGENT = bullet points).
 * Can receive a `correction_feedback` from Guardião when self-correction is active.
 *
 * Output is free text (json_strategy: text). Prompt hints still apply (e.g.
 * gemini_flash tightens verbosity), but no response_format is enforced.
 */
export async function run(state, { agent, openrouter }) {
  const {
    user_role,
    detected_intent,
    sentiment,
    calculated_proposal,
    motor_tactic_note,
    motor_reason,
    debt_info,
    message,
    correction_feedback,
  } = state

  const contextForLLM = {
    user_role,
    detected_intent,
    sentiment,
    original_message: message,
    calculated_proposal: calculated_proposal || null,
    tactic_note: motor_tactic_note || '',
    reason_no_proposal: motor_reason || '',
    debt_info: debt_info ? {
      debtor_name: debt_info.debtor_name,
      total_amount: debt_info.total_amount,
      days_overdue: debt_info.days_overdue,
    } : null,
    correction_feedback: correction_feedback || null,
  }

  const systemPrompt = agent.system_prompt + (correction_feedback
    ? `\n\nIMPORTANTE: Esta é uma REESCRITA. O Guardião recusou a versão anterior. Feedback: "${correction_feedback}". Reescreva completamente evitando os problemas apontados.`
    : '')

  const { content, usage, latencyMs } = await callOpenRouter({
    model: agent.model,
    temperature: agent.temperature ?? 0.7,
    system: systemPrompt,
    messages: [
      { role: 'user', content: `Contexto:\n${JSON.stringify(contextForLLM, null, 2)}\n\nGere a resposta final.` },
    ],
    jsonStrategy: agent.json_strategy || 'text',
    promptHints: agent.prompt_hints,
    apiKey: openrouter.apiKey,
    baseUrl: openrouter.baseUrl,
  })

  const thought = correction_feedback
    ? `Reescrevendo após feedback do Guardião: "${correction_feedback}"`
    : `Formatando resposta para persona [${user_role}] — intent: ${detected_intent}`

  return {
    patch: {
      draft_response: stripStrayFences(content),
    },
    trace: {
      agent: 'agente_empatia_copywriter',
      thought,
      tools: [],
      rag: [],
      tokens: usage.total_tokens,
      usage,
      latency_ms: latencyMs,
    },
  }
}

/**
 * Some smaller models occasionally wrap free-form text in markdown fences
 * (e.g. ```text … ```). Strip them so the draft reaches the Guardião clean.
 */
function stripStrayFences(text) {
  if (!text) return text
  const trimmed = String(text).trim()
  const fenced = trimmed.match(/^```(?:text|markdown)?\s*([\s\S]*?)\s*```$/i)
  return fenced ? fenced[1].trim() : trimmed
}
