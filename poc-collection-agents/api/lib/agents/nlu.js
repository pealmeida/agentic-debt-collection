import { callOpenRouter, parseJSON } from '../openrouter.js'

const NLU_SCHEMA = {
  type: 'object',
  properties: {
    detected_intent: { type: 'string', description: 'Intenção principal detectada' },
    sentiment: {
      type: 'string',
      enum: ['colaborativo', 'agressivo', 'desesperado', 'ansioso', 'neutro'],
    },
    confidence: { type: 'number' },
    summary: { type: 'string', description: 'Resumo em 1 frase do que o cliente disse' },
  },
  required: ['detected_intent', 'sentiment', 'confidence', 'summary'],
  additionalProperties: false,
}

/**
 * Agente Escuta Ativa (NLU)
 * Classifies intent and sentiment from the user message.
 * Only receives: message + history (no debt data yet — minimal context per
 * progressive disclosure principle).
 *
 * History window is tuned per profile (Gemini Flash → 4, OpenAI → 6) to keep
 * smaller models focused on the latest turn.
 */
export async function run(state, { agent, openrouter }) {
  const { message, history = [] } = state

  const historyWindow = agent.history_window ?? 6
  const historyMessages = history.slice(-historyWindow).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }))

  const { content, usage, latencyMs } = await callOpenRouter({
    model: agent.model,
    temperature: agent.temperature ?? 0.1,
    system: agent.system_prompt,
    messages: [
      ...historyMessages,
      { role: 'user', content: message },
    ],
    schema: NLU_SCHEMA,
    schemaName: 'nlu_output',
    jsonStrategy: agent.json_strategy,
    promptHints: agent.prompt_hints,
    apiKey: openrouter.apiKey,
    baseUrl: openrouter.baseUrl,
  })

  const parsed = parseJSON(content, {
    detected_intent: 'Pedido de acordo / Dificuldade Financeira',
    sentiment: 'neutro',
    confidence: 0.7,
    summary: message,
  })

  return {
    patch: {
      detected_intent: parsed.detected_intent,
      sentiment: parsed.sentiment,
      nlu_summary: parsed.summary,
    },
    trace: {
      agent: 'agente_escuta_nlu',
      thought: `Intent classificado: "${parsed.detected_intent}" | Sentimento: ${parsed.sentiment} (conf: ${parsed.confidence})`,
      tools: [],
      rag: [],
      tokens: usage.total_tokens,
      usage,
      latency_ms: latencyMs,
    },
  }
}
