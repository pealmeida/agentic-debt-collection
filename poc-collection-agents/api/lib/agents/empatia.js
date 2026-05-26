import { callOpenRouter } from '../openrouter.js'

/**
 * Hard cap on Empatia's draft length.
 *
 * Empatia is the only free-text agent (json_strategy: text). Without a schema
 * to bound the output, chatty models (observed: Qwen 3.6 Flash → 3000+ tokens)
 * will produce walls of text that:
 *   - Hurt UX (a WhatsApp reply should be 3 short paragraphs, ~150 tokens).
 *   - Inflate latency past Vercel's 30s maxDuration in api/orchestrate.js.
 *   - Multiply per-turn cost on premium models.
 *
 * Measured real outputs across all profiles:
 *   - CUSTOMER reply: ~120-180 completion tokens
 *   - AGENT bullet list: ~180-280 completion tokens
 *
 * Cap at 400 → ~30% latency headroom over the longest observed reply, but
 * still kills runaway generation. Decode latency is linear in output length,
 * so the lower cap directly reduces wall-clock time. Override per-agent via
 * `agent.max_tokens` in the YAML if a profile needs more breathing room.
 */
const EMPATIA_MAX_TOKENS = 400

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
        product: debt_info.product,
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
    maxTokens: agent.max_tokens ?? EMPATIA_MAX_TOKENS,
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
