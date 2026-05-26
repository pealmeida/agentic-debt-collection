const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

/**
 * Agnostic LLM wrapper around OpenRouter chat completions.
 *
 * The function is intentionally provider-agnostic: it accepts a `jsonStrategy`
 * + `promptHints` pair that lets each agent be tuned to the family of the
 * underlying model (OpenAI strict schema, Gemini json_object, prompted JSON,
 * etc.) without changing call sites.
 *
 * @param {object} opts
 * @param {string} opts.model          - OpenRouter slug (e.g. "google/gemini-2.5-flash-lite").
 * @param {string} opts.system         - System prompt (decorated with hints below).
 * @param {Array}  opts.messages       - Chat history [{role, content}].
 * @param {number} [opts.temperature]  - Defaults to 0.3.
 * @param {object} [opts.schema]       - JSON Schema (omit for free-text outputs).
 * @param {string} [opts.schemaName]   - Optional name for json_schema strict mode.
 * @param {('schema_strict'|'json_object'|'prompted_json'|'text')} [opts.jsonStrategy='schema_strict']
 * @param {('openai_strict'|'gemini_flash'|'claude_xml'|null)} [opts.promptHints]
 * @param {string} opts.apiKey         - OpenRouter API key.
 * @param {string} [opts.baseUrl]      - Override base URL.
 * @returns {{ content: string, usage: object, latencyMs: number, model: string }}
 */
export async function callOpenRouter({
  model,
  system,
  messages,
  temperature = 0.3,
  schema,
  schemaName = 'agent_output',
  jsonStrategy = 'schema_strict',
  promptHints = 'openai_strict',
  apiKey,
  baseUrl = OPENROUTER_BASE,
}) {
  const t0 = Date.now()

  const decoratedSystem = applyPromptHints(system, promptHints, { jsonStrategy, schema })
  const responseFormat = buildResponseFormat(jsonStrategy, schema, schemaName)

  const body = {
    model,
    temperature,
    messages: [{ role: 'system', content: decoratedSystem }, ...messages],
  }
  if (responseFormat) body.response_format = responseFormat

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

// ─── Strategy → response_format mapping ──────────────────────────────────────

/**
 * Build the request `response_format` field for a given JSON strategy.
 * Returns `null` to omit the field entirely (free text or prompted-JSON).
 *
 * Strategy matrix:
 *   schema_strict → OpenAI/Mistral fully support strict json_schema. Best signal.
 *   json_object   → Gemini, Claude (via OR), Mistral. More tolerant of small models.
 *   prompted_json → No structured-output API call; rely on prompt + parseJSON regex.
 *   text          → Free-form text (Empatia's draft).
 */
export function buildResponseFormat(strategy, schema, schemaName) {
  switch (strategy) {
    case 'schema_strict':
      if (!schema) return null
      return {
        type: 'json_schema',
        json_schema: { name: schemaName, strict: true, schema },
      }
    case 'json_object':
      return { type: 'json_object' }
    case 'prompted_json':
    case 'text':
    default:
      return null
  }
}

// ─── Prompt hint composition ─────────────────────────────────────────────────

/**
 * Decorate the system prompt with model-family-specific hints.
 *
 * Why: smaller / non-OpenAI models often emit prose around JSON, markdown
 * fences, or stray commentary. A short, deterministic suffix dramatically
 * improves parse rates without changing the agent's actual instructions.
 *
 * The base system_prompt in YAML stays model-agnostic.
 */
export function applyPromptHints(systemPrompt, hint, { jsonStrategy, schema } = {}) {
  if (!systemPrompt) return systemPrompt
  const wantsJson = jsonStrategy && jsonStrategy !== 'text'

  switch (hint) {
    case 'gemini_flash':
      return [
        systemPrompt,
        wantsJson
          ? buildJsonContract(schema, {
              header: 'FORMATO DE SAÍDA (Gemini Flash):',
              bullets: [
                'Responda APENAS com JSON válido em uma única linha ou bloco.',
                'NÃO use markdown, fences (```), prefixos como "json:" nem comentários.',
                'NÃO escreva texto antes ou depois do JSON.',
                'Se um campo for desconhecido, use string vazia "" ou 0, nunca null.',
              ],
            })
          : 'ESTILO: seja conciso, direto e mantenha tom natural. Sem markdown pesado, sem listas longas.',
      ]
        .filter(Boolean)
        .join('\n\n')

    case 'claude_xml':
      return [
        systemPrompt,
        wantsJson
          ? buildJsonContract(schema, {
              header: 'FORMATO DE SAÍDA (Claude):',
              bullets: [
                'Pense brevemente, depois retorne APENAS o JSON solicitado.',
                'Sem texto antes/depois do JSON. Sem code fences.',
                'Use exatamente as chaves listadas no schema.',
              ],
            })
          : null,
      ]
        .filter(Boolean)
        .join('\n\n')

    case 'openai_strict':
    default:
      // OpenAI handles json_schema strict natively — no extra hints needed.
      return systemPrompt
  }
}

function buildJsonContract(schema, { header, bullets }) {
  const lines = [header, ...bullets.map((b) => `- ${b}`)]
  if (schema?.properties) {
    const keys = Object.keys(schema.properties).join(', ')
    lines.push(`- Chaves obrigatórias: ${keys}.`)
  }
  return lines.join('\n')
}

// ─── JSON parsing ────────────────────────────────────────────────────────────

/**
 * Parse JSON from an LLM response, with graceful fallback.
 * Handles common small-model quirks: markdown fences, trailing commentary,
 * leading prose, and stray ` ```json ` blocks.
 */
export function parseJSON(content, fallback = {}) {
  if (!content) return fallback
  const text = String(content).trim()

  // Strip ```json … ``` and ``` … ``` fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const candidate = fenced ? fenced[1] : text

  try {
    return JSON.parse(candidate)
  } catch {
    // Last-resort: pull the first {...} block.
    const objMatch = candidate.match(/\{[\s\S]*\}/)
    if (objMatch) {
      try {
        return JSON.parse(objMatch[0])
      } catch {
        return fallback
      }
    }
    return fallback
  }
}
