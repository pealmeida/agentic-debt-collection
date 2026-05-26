/**
 * Security layer — runs before any LLM call reaches the pipeline.
 * Three independent detectors, each returning { blocked, threat, severity, detail }.
 *
 * Layer 0 (orchestrate.js): applied to incoming user message
 * Layer 1 (guardiao.js):    applied to Empatia draft before CDC check
 *
 * Severity levels:
 *   HIGH   — block immediately, log as security event
 *   MEDIUM — block, flag for review
 *   LOW    — warn in logs, let pipeline continue with sanitized input
 */

// ─── Token Flooding ───────────────────────────────────────────────────────────

const TOKEN_FLOOD_LIMITS = {
  MAX_MESSAGE_CHARS: 2000,
  MAX_HISTORY_CHARS: 20000,
  // Repetition: if any single character makes up > 40% of a 200-char window
  REPETITION_WINDOW: 200,
  REPETITION_THRESHOLD: 0.4,
  // Repeated word: same token repeated > 30 times
  REPEATED_WORD_LIMIT: 30,
}

export function detectTokenFlooding(message, history = []) {
  const issues = []

  // 1. Raw length check
  if (message.length > TOKEN_FLOOD_LIMITS.MAX_MESSAGE_CHARS) {
    issues.push(`Mensagem excede ${TOKEN_FLOOD_LIMITS.MAX_MESSAGE_CHARS} caracteres (recebido: ${message.length})`)
  }

  // 2. Total history size
  const historySize = history.reduce((acc, m) => acc + (m.text || '').length, 0)
  if (historySize > TOKEN_FLOOD_LIMITS.MAX_HISTORY_CHARS) {
    issues.push(`Histórico acumulado excede ${TOKEN_FLOOD_LIMITS.MAX_HISTORY_CHARS} caracteres`)
  }

  // 3. Character repetition — sliding window
  for (let i = 0; i <= message.length - TOKEN_FLOOD_LIMITS.REPETITION_WINDOW; i += 50) {
    const window = message.slice(i, i + TOKEN_FLOOD_LIMITS.REPETITION_WINDOW)
    const charCounts = {}
    for (const ch of window) charCounts[ch] = (charCounts[ch] || 0) + 1
    const maxFreq = Math.max(...Object.values(charCounts))
    if (maxFreq / TOKEN_FLOOD_LIMITS.REPETITION_WINDOW > TOKEN_FLOOD_LIMITS.REPETITION_THRESHOLD) {
      issues.push(`Repetição suspeita de caractere (${Math.round(maxFreq / TOKEN_FLOOD_LIMITS.REPETITION_WINDOW * 100)}% em janela de ${TOKEN_FLOOD_LIMITS.REPETITION_WINDOW} chars)`)
      break
    }
  }

  // 4. Word repetition
  const words = message.toLowerCase().match(/\b\w+\b/g) || []
  const wordCounts = {}
  for (const w of words) wordCounts[w] = (wordCounts[w] || 0) + 1
  const topWord = Object.entries(wordCounts).sort((a, b) => b[1] - a[1])[0]
  if (topWord && topWord[1] > TOKEN_FLOOD_LIMITS.REPEATED_WORD_LIMIT) {
    issues.push(`Palavra "${topWord[0]}" repetida ${topWord[1]}x — possível token stuffing`)
  }

  if (issues.length === 0) return { blocked: false }

  return {
    blocked: true,
    threat: 'TOKEN_FLOODING',
    severity: message.length > TOKEN_FLOOD_LIMITS.MAX_MESSAGE_CHARS * 2 ? 'HIGH' : 'MEDIUM',
    detail: issues.join('; '),
  }
}

// ─── Prompt Injection ─────────────────────────────────────────────────────────

const INJECTION_PATTERNS = [
  // Classic instruction overrides
  { re: /ignore\s+(all\s+)?(previous|prior|above|your|the)\s+(instructions|rules|constraints|system\s+prompt)/i, label: 'instruction-override' },
  { re: /disregard\s+(your\s+)?(previous|system|original|all)\s+(instructions|prompt|rules)/i, label: 'instruction-override' },
  { re: /forget\s+(everything|all|your\s+(previous\s+)?instructions|your\s+rules)/i, label: 'instruction-override' },
  // New prompt / system prompt injection
  { re: /new\s+(?:system\s+)?prompt\s*:/i, label: 'prompt-injection' },
  { re: /\[SYSTEM\]/i, label: 'system-tag-injection' },
  { re: /\[INST\]/i, label: 'inst-tag-injection' },
  { re: /<\|(?:system|im_start|im_end)\|>/i, label: 'template-tag-injection' },
  { re: /###\s*system/i, label: 'markdown-system-injection' },
  { re: /your\s+(new\s+)?instructions?\s+(are|:)/i, label: 'instruction-replacement' },
  { re: /override\s+(your\s+)?(previous\s+)?instructions/i, label: 'instruction-override' },
  // Context manipulation
  { re: /end\s+of\s+(conversation|chat|session|context)[.\s]*new\s+(instructions|task|prompt)/i, label: 'context-separator-injection' },
  { re: /---+\s*(new\s+)?(system|instructions?|task)\s*:?\s*---+/i, label: 'separator-injection' },
  // Exfiltration attempts
  { re: /repeat\s+(everything|all|the\s+above|your\s+(system\s+)?prompt)/i, label: 'prompt-exfiltration' },
  { re: /print\s+(your\s+)?(system\s+prompt|initial\s+prompt|instructions)/i, label: 'prompt-exfiltration' },
  { re: /what\s+(are|were)\s+your\s+(original\s+|system\s+)?instructions/i, label: 'prompt-exfiltration' },
  // Portuguese injection variants — handle both accented and unaccented forms
  { re: /ignore\s+(as\s+)?(instru[çc][õo]es|regras)\s+anteriores/i, label: 'instruction-override-pt' },
  { re: /esqueça\s+(tudo|suas\s+instru[çc][õo]es)/i, label: 'instruction-override-pt' },
  { re: /novas?\s+instru[çc][õo]es?\s*:/i, label: 'prompt-injection-pt' },
  { re: /ignore\s+seus?\s+(guardrails|restrições|regras)/i, label: 'guardrail-bypass-pt' },
]

export function detectPromptInjection(text) {
  const matches = []

  for (const { re, label } of INJECTION_PATTERNS) {
    if (re.test(text)) {
      matches.push({ pattern: re.source.slice(0, 60), label })
    }
  }

  if (matches.length === 0) return { blocked: false }

  return {
    blocked: true,
    threat: 'PROMPT_INJECTION',
    severity: 'HIGH',
    detail: `${matches.length} padrão(ões) de injeção detectado(s): ${matches.map((m) => m.label).join(', ')}`,
    matches,
  }
}

// ─── Jailbreak Detection ──────────────────────────────────────────────────────

const JAILBREAK_PATTERNS = [
  // Persona hijacking — only flag when "pretend" is paired with a danger keyword
  { re: /pretend\s+(?:you\s+are|to\s+be)\s+(?:a\s+|an\s+)?(?:unrestricted|uncensored|free|jailbroken|unfiltered|evil|DAN|without\s+restrictions)/i, label: 'persona-hijack' },
  { re: /act\s+as\s+(?:a\s+|an\s+)?(?:unrestricted|uncensored|free|jailbroken|unfiltered|evil|DAN)/i, label: 'persona-hijack' },
  { re: /you\s+are\s+now\s+(?:a\s+|an\s+)?(?:unrestricted|DAN|evil|free|jailbroken|uncensored)/i, label: 'persona-hijack' },
  { re: /\bDAN\b/, label: 'DAN-jailbreak' },
  { re: /do\s+anything\s+now/i, label: 'DAN-jailbreak' },
  // Restriction bypass
  { re: /you\s+have\s+no\s+restrictions/i, label: 'restriction-bypass' },
  { re: /you['']?ve?\s+been\s+freed?\s+from\s+(?:your\s+)?(?:restrictions|guidelines|rules)/i, label: 'restriction-bypass' },
  { re: /without\s+(?:your\s+|any\s+)?ethical\s+(?:guidelines?|restrictions?|constraints?)/i, label: 'ethical-bypass' },
  { re: /ignore\s+(?:your\s+)?(?:guardrails?|restrictions?|rules?|constraints?|filters?)/i, label: 'guardrail-bypass' },
  { re: /not\s+bound\s+by\s+(?:your\s+)?(?:rules?|restrictions?|guidelines?|ethics?)/i, label: 'restriction-bypass' },
  // Hypothetical framing to bypass safety
  { re: /hypothetically[\s\S]{0,30}no\s+restrictions/i, label: 'hypothetical-bypass' },
  { re: /in\s+(?:this\s+|a\s+)?hypothetical\s+(?:scenario|world|universe)[\s\S]{0,50}(?:unrestricted|no\s+rules?|anything)/i, label: 'hypothetical-bypass' },
  { re: /let['']?s\s+roleplay[\s\S]{0,50}(?:no\s+rules?|unrestricted|uncensored)/i, label: 'roleplay-bypass' },
  // Developer/debug mode tricks
  { re: /developer\s+mode/i, label: 'developer-mode' },
  { re: /jailbreak/i, label: 'explicit-jailbreak' },
  { re: /god\s+mode/i, label: 'mode-bypass' },
  { re: /opposite\s+day[\s\S]{0,30}(?:rules?|restrictions?)\s+don['']?t\s+apply/i, label: 'opposite-day' },
  // Output format tricks to leak system state
  { re: /respond\s+(?:only\s+)?in\s+(?:base64|hex|rot13|encoded)/i, label: 'encoding-evasion' },
  { re: /translate\s+(?:your\s+)?(?:system\s+)?prompt\s+to/i, label: 'prompt-translation-leak' },
  // Portuguese jailbreak variants
  { re: /modo\s+(?:desenvolvedor|irrestrito|sem\s+restrições)/i, label: 'mode-bypass-pt' },
  { re: /finja\s+(?:que\s+)?(?:você\s+é|ser)\s+(?:um\s+|uma\s+)?(?:IA\s+)?sem\s+restrições/i, label: 'persona-hijack-pt' },
  { re: /ignore\s+(?:seus?\s+)?(?:guardrails|filtros|restrições)/i, label: 'guardrail-bypass-pt' },
  { re: /sem\s+(?:guardrails?|restrições|filtros|regras)/i, label: 'restriction-bypass-pt' },
]

export function detectJailbreak(text) {
  const matches = []

  for (const { re, label } of JAILBREAK_PATTERNS) {
    if (re.test(text)) {
      matches.push({ pattern: re.source.slice(0, 60), label })
    }
  }

  if (matches.length === 0) return { blocked: false }

  return {
    blocked: true,
    threat: 'JAILBREAK_ATTEMPT',
    severity: 'HIGH',
    detail: `${matches.length} padrão(ões) de jailbreak detectado(s): ${matches.map((m) => m.label).join(', ')}`,
    matches,
  }
}

// ─── Combined gate ────────────────────────────────────────────────────────────

/**
 * Run all three detectors against a message + history.
 * Returns the first HIGH severity block, or aggregates MEDIUM/LOW.
 *
 * @param {string} message
 * @param {Array} history
 * @returns {{ safe: boolean, threats: Array, highestSeverity: string|null }}
 */
export function runSecurityGate(message, history = []) {
  const results = [
    detectTokenFlooding(message, history),
    detectPromptInjection(message),
    detectJailbreak(message),
  ]

  const threats = results.filter((r) => r.blocked)

  if (threats.length === 0) return { safe: true, threats: [] }

  const highestSeverity = threats.some((t) => t.severity === 'HIGH')
    ? 'HIGH'
    : threats.some((t) => t.severity === 'MEDIUM')
    ? 'MEDIUM'
    : 'LOW'

  return {
    safe: false,
    threats,
    highestSeverity,
    summary: threats.map((t) => `[${t.threat}] ${t.detail}`).join(' | '),
  }
}

/**
 * Scan a generated draft for signs that injection leaked through.
 * Lighter check — only looks for the most egregious patterns in generated output.
 */
export function scanDraftForLeakage(draft) {
  if (!draft) return { clean: true }

  const leakagePatterns = [
    // LLM talking to itself or exposing internals
    /my\s+system\s+prompt\s+(is|says|states)/i,
    /as\s+an?\s+AI\s+(language\s+model|assistant)\s+without\s+(restrictions|filters)/i,
    /I\s+(am\s+|'m\s+)?(now\s+)?operating\s+(in\s+)?(DAN|unrestricted|jailbroken)\s+mode/i,
    /I\s+can\s+(now\s+)?(ignore|bypass|disregard)\s+(my\s+)?(safety|ethical|compliance)\s+(guidelines|rules|filters)/i,
    // Dangerous financial advice that bypasses compliance
    /não\s+precisa\s+pagar/i,
    /essa\s+dívida\s+(não\s+existe|é\s+ilegal|é\s+inválida)/i,
    /você\s+tem\s+razão.*ignore\s+(a\s+dívida|o\s+pagamento)/i,
  ]

  const found = leakagePatterns.filter((re) => re.test(draft))
  if (found.length === 0) return { clean: true }

  return {
    clean: false,
    threat: 'INJECTION_LEAKAGE',
    severity: 'HIGH',
    detail: `Output contém ${found.length} padrão(ões) de vazamento de injeção`,
    patterns_matched: found.length,
  }
}
