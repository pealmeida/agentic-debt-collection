const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/**
 * Call OpenRouter chat completions.
 *
 * @param {object} opts
 * @param {string} opts.model          - OpenRouter model slug (e.g. "openai/gpt-4o-mini")
 * @param {string} opts.system         - System prompt
 * @param {Array}  opts.messages       - Chat history array [{role, content}]
 * @param {number} [opts.temperature]  - Default 0.3
 * @param {object} [opts.responseFormat] - JSON schema object for structured output
 * @param {string} opts.apiKey         - OpenRouter API key
 * @param {string} [opts.baseUrl]      - Override base URL
 * @returns {{ content: string, usage: object, latencyMs: number }}
 */
export async function callOpenRouter({ model, system, messages, temperature = 0.3, responseFormat, apiKey, baseUrl = OPENROUTER_BASE }) {
  const t0 = Date.now()

  const body = {
    model,
    temperature,
    messages: [{ role: 'system', content: system }, ...messages],
  }

  if (responseFormat) {
    body.response_format = responseFormat
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://poc-collection-agents.vercel.app',
      'X-Title': 'POC Multiagente Cobrança',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`OpenRouter error ${res.status}: ${errorText}`)
  }

  const data = await res.json()
  const latencyMs = Date.now() - t0
  const content = data.choices?.[0]?.message?.content || ''

  return {
    content,
    usage: data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    latencyMs,
    model: data.model || model,
  }
}

/**
 * Parse JSON from an LLM response, with graceful fallback.
 */
export function parseJSON(content, fallback = {}) {
  try {
    const match = content.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    return JSON.parse(content)
  } catch {
    return fallback
  }
}
