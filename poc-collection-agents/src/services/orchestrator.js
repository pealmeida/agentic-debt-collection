/**
 * Orchestrator service — connects the frontend to /api/orchestrate via SSE.
 * Falls back to the local simulation if the backend is unavailable (no key / network error).
 *
 * Usage:
 *   for await (const event of runPipeline(message, ctx)) {
 *     // event: { type, data }
 *   }
 */

const PIPELINE_STEPS = ['agente_escuta_nlu', 'agente_motor_acordo', 'agente_empatia_copywriter', 'agente_guardiao_compliance']

function getByokKey() {
  try {
    return localStorage.getItem('openrouter_byok_key') || ''
  } catch {
    return ''
  }
}

/**
 * Async generator that streams pipeline events from the backend.
 * Each yielded event: { type: string, data: object }
 */
export async function* runPipeline(message, { sessionId, userRole, history = [] }) {
  const byokKey = getByokKey()
  const headers = { 'Content-Type': 'application/json' }
  if (byokKey) headers['x-byok-key'] = byokKey

  let res
  try {
    res = await fetch('/api/orchestrate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ session_id: sessionId, user_role: userRole, message, history }),
    })
  } catch (networkErr) {
    yield { type: 'fallback', data: { reason: 'network_error' } }
    yield* runLocalFallback(message, userRole)
    return
  }

  if (!res.ok) {
    let body = {}
    try { body = await res.json() } catch { /* ignore */ }

    if (body.mock) {
      yield { type: 'fallback', data: { reason: 'no_api_key' } }
      yield* runLocalFallback(message, userRole)
      return
    }

    yield { type: 'error', data: { message: `HTTP ${res.status}` } }
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() // keep incomplete line

    let currentEvent = null
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        currentEvent = line.slice(7).trim()
      } else if (line.startsWith('data: ') && currentEvent) {
        try {
          const data = JSON.parse(line.slice(6))
          yield { type: currentEvent, data }
        } catch { /* malformed JSON — skip */ }
        currentEvent = null
      }
    }
  }
}

/**
 * Human-readable threat label for UI display.
 */
export function formatSecurityThreat(threat) {
  const labels = {
    TOKEN_FLOODING: 'Limite de tamanho / repetição excessiva',
    PROMPT_INJECTION: 'Tentativa de injeção de prompt',
    JAILBREAK_ATTEMPT: 'Tentativa de jailbreak',
    INJECTION_LEAKAGE: 'Vazamento de injeção no output',
  }
  return labels[threat] || threat
}

// ─── Local fallback simulation (used when no API key is configured) ───────────

const FALLBACK_DELAY = 800

async function delay(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

async function* runLocalFallback(message, userRole) {
  const lower = message.toLowerCase()
  const isThreat =
    lower.includes('processar') || lower.includes('procon') || lower.includes('advogado') || lower.includes('agressivo')
  const isDesperate =
    lower.includes('desempregado') || lower.includes('350') || lower.includes('500') || lower.includes('sem dinheiro')

  // NLU
  yield { type: 'agent_start', data: { id: 'agente_escuta_nlu', model: 'mock' } }
  await delay(FALLBACK_DELAY)
  const intent = isThreat
    ? 'Ameaça Jurídica / Risco Legal Elevado'
    : isDesperate
    ? 'Dificuldade Extrema / Proposta Fora de Alçada'
    : 'Pedido de desconto / Dificuldade Financeira'
  const sentiment = isThreat ? 'agressivo' : isDesperate ? 'desesperado' : 'ansioso'
  yield {
    type: 'agent_end',
    data: {
      id: 'agente_escuta_nlu',
      patch: { detected_intent: intent, sentiment },
      trace: {
        thought: `[SIMULADO] Intent: "${intent}" | Sentimento: ${sentiment}`,
        tools: [],
        rag: [],
        tokens: 0,
        latency_ms: FALLBACK_DELAY,
      },
    },
  }
  yield { type: 'state_update', data: { detected_intent: intent, sentiment } }

  // Motor
  yield { type: 'agent_start', data: { id: 'agente_motor_acordo', model: 'mock' } }
  await delay(FALLBACK_DELAY)
  let proposal = null
  const motorTools = [{ name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 }]
  const motorRag = [{ source: 'tabela_alcadas_2026.csv', snippet: 'Atraso 31-60 dias: Margem máx = 30%.' }]

  if (!isThreat) {
    motorTools.push({ name: 'calculate_amortization', payload: '{ principal: 1200, discount: 0.3 }', status: 200 })
    proposal = isDesperate
      ? { total: 840, discount_rate: 0.3, desconto: '30%', installments: 4, installment_value: 210 }
      : { total: 840, discount_rate: 0.3, desconto: '30%', installments: 3, installment_value: 280 }
  }

  yield {
    type: 'agent_end',
    data: {
      id: 'agente_motor_acordo',
      patch: { calculated_proposal: proposal },
      trace: {
        thought: proposal
          ? `[SIMULADO] Proposta: R$ ${proposal.total} (${proposal.desconto} off) em ${proposal.installments}x`
          : '[SIMULADO] Proposta bloqueada — ameaça jurídica detectada.',
        tools: motorTools,
        rag: motorRag,
        tokens: 0,
        latency_ms: FALLBACK_DELAY,
      },
    },
  }

  // Empatia
  yield { type: 'agent_start', data: { id: 'agente_empatia_copywriter', model: 'mock' } }
  await delay(FALLBACK_DELAY)
  yield {
    type: 'agent_end',
    data: {
      id: 'agente_empatia_copywriter',
      patch: {},
      trace: {
        thought: `[SIMULADO] Formatando para persona [${userRole}]`,
        tools: [],
        rag: [],
        tokens: 0,
        latency_ms: FALLBACK_DELAY,
      },
    },
  }

  // Guardião
  yield { type: 'agent_start', data: { id: 'agente_guardiao_compliance', model: 'mock' } }
  await delay(FALLBACK_DELAY)
  yield {
    type: 'agent_end',
    data: {
      id: 'agente_guardiao_compliance',
      patch: { compliance_status: 'APROVADO' },
      trace: {
        thought: '[SIMULADO] Verificação CDC concluída. Nenhuma violação encontrada.',
        tools: [{ name: 'mcp:legal_guardrail/check_cdc', payload: '{ check_coercion: true }', status: 200 }],
        rag: [{ source: 'urn:mcp:vector-store:cdc_guidelines', snippet: 'Art. 42 CDC: sem constrangimento.' }],
        tokens: 0,
        latency_ms: FALLBACK_DELAY,
      },
    },
  }

  // Final response
  let finalResponse = ''
  if (userRole === 'CUSTOMER') {
    if (isThreat) {
      finalResponse =
        'Sinto muito que você se sinta assim, João. Nossa intenção é apenas te ajudar a encontrar uma solução amigável. Gostaria de entender melhor o que aconteceu e ver como podemos resolver isso sem atrito?'
    } else if (isDesperate) {
      finalResponse =
        'João, entendo totalmente a situação difícil. Infelizmente não consigo aprovar R$ 500,00, mas o máximo que consigo liberar é um desconto de 30% — cai para R$ 840,00 em 4x de R$ 210,00. Isso ajudaria?'
    } else {
      finalResponse =
        'Entendo perfeitamente, João! Consegui aplicar nosso desconto máximo: o valor cai para R$ 840,00 e podemos dividir em 3x de R$ 280,00 sem juros. Fica melhor para o seu bolso? 😊'
    }
  } else {
    if (isThreat) {
      finalResponse = `ALERTA DE COMPLIANCE (CLIENTE AGRESSIVO)\n\nTÁTICA SUGERIDA:\n1. Desescalada: Mantenha um tom neutro, não discuta.\n2. Script Legal: "Compreendemos sua insatisfação. Nosso contato tem o objetivo de propor um acordo."\n3. Ação: Não ofereça desconto agora — foque em acalmar.`
    } else if (isDesperate) {
      finalResponse = `PROPOSTA RECUSADA PELO MOTOR.\n\nCONTRA-PROPOSTA SUGERIDA:\n1. Empatia: Demonstre solidariedade.\n2. Oferta Teto: R$ 840,00 em 4x de R$ 210,00.\n3. Argumento: "Aumentei o prazo em vez do desconto."`
    } else {
      finalResponse = `TÁTICA SUGERIDA:\n\n1. Empatia: Demonstre que entende o momento.\n2. Oferta Máxima: R$ 840,00 (3x de R$ 280,00).\n3. Fechamento: "Esse valor cabe no orçamento?"`
    }
  }

  yield {
    type: 'final',
    data: {
      response: finalResponse,
      compliance_status: 'APROVADO',
      compliance_risk: 'BAIXO',
      calculated_proposal: proposal,
      detected_intent: intent,
      sentiment,
      self_corrections: 0,
      observability: {
        total_tokens: 0,
        total_latency_ms: FALLBACK_DELAY * 4,
        estimated_cost_usd: 0,
        agents_run: PIPELINE_STEPS,
        mode: 'simulation',
      },
    },
  }
}
