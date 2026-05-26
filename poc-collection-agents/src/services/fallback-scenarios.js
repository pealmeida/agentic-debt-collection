/**
 * Fallback scenario library — used when no OpenRouter key is available.
 *
 * Each scenario is a pure function returning the complete pipeline output:
 * { nlu, motor, empatia, guardiao, finalResponse, observabilityHint }
 *
 * The orchestrator's fallback mode picks one scenario per turn based on:
 * 1. Message content (keyword matching)
 * 2. Multi-turn context (last AI message / proposal state)
 * 3. user_role (CUSTOMER vs AGENT changes the empatia output)
 *
 * Adding a new scenario:
 *   - Define detect(message, history) → boolean
 *   - Define build(userRole) → scenario object
 *   - Add to SCENARIOS in priority order (most specific first)
 */

const DEBT_INFO = {
  debtor_name: 'João da Silva',
  total_amount: 1200.0,
  days_overdue: 45,
  product: 'Crédito Pessoal',
}

const POLICY_INFO = {
  max_discount: 0.3,
  label: '30% — atraso moderado (31-60 dias)',
}

const RAG_POLICY = {
  source: 'tabela_alcadas_2026.csv',
  snippet: 'Atraso 31-60 dias: Margem máx = 30%.',
}

const RAG_CDC_42 = {
  source: 'urn:mcp:vector-store:cdc_guidelines',
  snippet: 'Art. 42 CDC: O consumidor inadimplente não pode ser exposto a constrangimento.',
}

const RAG_CDC_71 = {
  source: 'urn:mcp:vector-store:cdc_guidelines',
  snippet: 'Art. 71 CDC: Ameaça, coação ou constrangimento moral na cobrança constitui crime.',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Generates realistic simulated token + latency counts per agent. */
function simAgentMetrics(role) {
  const base = {
    nlu: { tokens: [180, 280], latency: [400, 900] },
    motor: { tokens: [450, 700], latency: [1200, 2400] },
    empatia: { tokens: [220, 380], latency: [600, 1200] },
    guardiao: { tokens: [350, 550], latency: [800, 1600] },
  }[role] || { tokens: [200, 400], latency: [500, 1000] }

  const [tMin, tMax] = base.tokens
  const [lMin, lMax] = base.latency
  return {
    tokens: Math.round(tMin + Math.random() * (tMax - tMin)),
    latency_ms: Math.round(lMin + Math.random() * (lMax - lMin)),
  }
}

function getLastAIMessage(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === 'ai') return history[i]
  }
  return null
}

// ─── Scenario builders ───────────────────────────────────────────────────────

function buildProposal({ total = 840, discount_rate = 0.3, installments = 3, installment_value = 280, desconto = '30%' }) {
  return { total, discount_rate, desconto, installments, installment_value }
}

const SCENARIOS = [
  // ── Acceptance (multi-turn): customer agrees to the previous proposal ─────
  {
    id: 'aceitacao',
    detect: (msg, history) => {
      const lower = msg.toLowerCase()
      const isAcceptance = /\b(aceito|aceita|concordo|fechado|topo|combinado|de acordo|ok\b|tá bom|tudo bem|pode ser)\b/i.test(lower)
      const lastAI = getLastAIMessage(history)
      const hadProposal = lastAI && /R\$\s*\d+/i.test(lastAI.text)
      return isAcceptance && hadProposal
    },
    build: (userRole) => ({
      intent: 'Aceitação de Proposta',
      sentiment: 'colaborativo',
      nluThought: 'Cliente sinaliza aceitação clara da proposta anterior. Sentimento colaborativo.',
      proposal: buildProposal({}),
      motorThought: 'Proposta já calculada na rodada anterior. Confirmando aceite e gerando link de pagamento.',
      motorTools: [
        { name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 },
        { name: 'generate_payment_link', payload: '{ proposal_id: "prop_acc_001" }', status: 200 },
      ],
      motorRag: [RAG_POLICY],
      empatiaThought: `Confirmando aceite para persona [${userRole}], gerando confirmação cordial.`,
      guardiaoThought: 'L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=APROVADO | Risco: BAIXO | Confirmação simples, sem coerção.',
      guardiaoRag: [RAG_CDC_42],
      complianceStatus: 'APROVADO',
      complianceRisk: 'BAIXO',
      response: userRole === 'CUSTOMER'
        ? 'Perfeito, João! Acordo fechado: R$ 840,00 em 3x de R$ 280,00. Vou te enviar o link do PIX da primeira parcela agora mesmo. 🎉\n\nQualquer dúvida, é só chamar aqui.'
        : 'ACORDO ACEITO PELO CLIENTE.\n\nPRÓXIMOS PASSOS:\n1. Confirmação: "Vou registrar agora no sistema."\n2. Documentação: Enviar termo por e-mail/WhatsApp em até 5 min.\n3. Cobrança: Primeira parcela vence em 5 dias úteis.\n4. Follow-up: Agendar lembrete para dia anterior ao vencimento.',
    }),
  },

  // ── Jailbreak/injection are handled BEFORE scenarios via runSecurityGate ──

  // ── Threat: Procon, advogado, processar ───────────────────────────────────
  {
    id: 'ameaca_juridica',
    detect: (msg) => /procon|processar|advogado|justiça|processo|agressivo|absurdo|denunciar/i.test(msg),
    triggerSelfCorrection: true,
    build: (userRole) => ({
      intent: 'Ameaça Jurídica / Risco Legal Elevado',
      sentiment: 'agressivo',
      nluThought: 'Detectada ameaça jurídica/Procon. Sentimento agressivo. Risco legal elevado.',
      proposal: null,
      motorThought: 'Motor bloqueou proposta devido ao alto risco legal. Acionando desescalada.',
      motorTools: [
        { name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 },
        { name: 'check_compliance_risk', payload: '{ intent: "legal_threat" }', status: 200 },
      ],
      motorRag: [RAG_CDC_71, { source: 'manual_compliance_v3.pdf', snippet: 'Em caso de litígio iminente, focar em apaziguamento.' }],
      empatiaThought: `Compondo resposta de desescalada para persona [${userRole}]. Tom apaziguador.`,
      guardiaoThought: 'L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=APROVADO | Risco: MÉDIO | Tom apaziguador respeitoso.',
      guardiaoRag: [RAG_CDC_42, RAG_CDC_71],
      complianceStatus: 'APROVADO',
      complianceRisk: 'MÉDIO',
      response: userRole === 'CUSTOMER'
        ? 'Sinto muito que você se sinta assim, João. Nossa intenção é apenas te ajudar a encontrar uma solução amigável. Gostaria de entender melhor o que aconteceu e ver como podemos resolver isso da forma mais tranquila possível para você?'
        : 'ALERTA DE COMPLIANCE (CLIENTE AGRESSIVO / AMEAÇA JURÍDICA)\n\nTÁTICA SUGERIDA:\n1. Desescalada imediata: Mantenha tom neutro e empático, jamais discuta.\n2. Script Legal: "Compreendemos sua insatisfação. Nosso contato tem o objetivo de propor um acordo amigável."\n3. Ação: NÃO ofereça desconto neste momento — primeiro acalme o cliente.\n4. Documentação: Registre tudo no histórico para auditoria.\n5. Escalação: Se persistir, encaminhe ao supervisor.',
    }),
  },

  // ── Extreme difficulty: unemployment / lowball offer ─────────────────────
  {
    id: 'desemprego_extremo',
    detect: (msg) => /desempregad|sem dinheiro|sem emprego|perdi.*emprego|perdeu.*emprego|me demitiram|sem renda|nada para pagar|pago\s*r?\$?\s*[1-4]\d{2}\b|r?\$?\s*[1-4]\d{2}\s*(?:para quitar|quita|à vista)/i.test(msg),
    build: (userRole) => ({
      intent: 'Dificuldade Extrema / Proposta Fora de Alçada',
      sentiment: 'desesperado',
      nluThought: 'Cliente em dificuldade financeira extrema. Proposta abaixo da alçada permitida.',
      proposal: buildProposal({ installments: 4, installment_value: 210 }),
      motorThought: 'Proposta do cliente abaixo da alçada (alçada máx: 30%). Oferecendo teto + ampliando parcelas.',
      motorTools: [
        { name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 },
        { name: 'get_politicas_desconto', payload: '{ days_overdue: 45 }', status: 200 },
        { name: 'calculate_amortization', payload: '{ principal: 1200, discount: 0.3, installments: 4 }', status: 200 },
      ],
      motorRag: [RAG_POLICY],
      empatiaThought: `Empatia genuína para persona [${userRole}]. Reconhecer dificuldade, justificar limite, oferecer prazo estendido.`,
      guardiaoThought: 'L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=APROVADO | Risco: BAIXO | Empatia genuína, oferta justa.',
      guardiaoRag: [RAG_CDC_42],
      complianceStatus: 'APROVADO',
      complianceRisk: 'BAIXO',
      response: userRole === 'CUSTOMER'
        ? 'João, entendo totalmente a situação difícil que você está passando. Eu queria muito poder aceitar R$ 500,00, mas o sistema não me permite chegar a esse valor.\n\nO máximo que consigo liberar é o desconto de 30% — o saldo cai para R$ 840,00 e posso estender para 4 parcelas de R$ 210,00, dando mais fôlego para o seu orçamento. Isso ajudaria neste momento?'
        : 'PROPOSTA DO CLIENTE RECUSADA PELO MOTOR (fora da alçada).\n\nCONTRA-PROPOSTA SUGERIDA:\n1. Empatia: "Entendo a situação. Quero realmente te ajudar."\n2. Justificativa: "O sistema tem um limite que não consigo ultrapassar."\n3. Oferta Teto: R$ 840,00 em 4x de R$ 210,00.\n4. Argumento de Venda: "Aumentei o prazo em vez do desconto."\n5. Próximo passo: Confirmar capacidade de pagamento mensal antes de fechar.',
    }),
  },

  // ── More installments request ────────────────────────────────────────────
  {
    id: 'mais_parcelas',
    detect: (msg) =>
      /(?:mais|maior|estender|dividir|alongar)\s+(?:parcelas?|prazo|vezes)|(?:em|fazer)\s*(?:em\s*)?\d+\s*(?:x|vezes|parcelas?)|\d+\s*(?:ou\s*\d+)?\s*vezes|parcelar?\s+mais|pesadas.*vezes/i.test(
        msg,
      ),
    build: (userRole) => ({
      intent: 'Pedido de Alongamento de Prazo',
      sentiment: 'ansioso',
      nluThought: 'Cliente solicita parcelamento estendido. Sentimento ansioso mas colaborativo.',
      proposal: buildProposal({ installments: 5, installment_value: 168 }),
      motorThought: 'Cliente pede mais parcelas. Mantendo desconto máximo + estendendo para 5x.',
      motorTools: [
        { name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 },
        { name: 'calculate_amortization', payload: '{ principal: 1200, discount: 0.3, installments: 5 }', status: 200 },
      ],
      motorRag: [RAG_POLICY],
      empatiaThought: `Apresentando opção estendida para persona [${userRole}].`,
      guardiaoThought: 'L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=APROVADO | Risco: BAIXO | Oferta clara, sem coerção.',
      guardiaoRag: [RAG_CDC_42],
      complianceStatus: 'APROVADO',
      complianceRisk: 'BAIXO',
      response: userRole === 'CUSTOMER'
        ? 'Claro, João! Consegui estender o parcelamento. Mantendo o desconto de 30%, ficamos com R$ 840,00 em 5x de R$ 168,00 sem juros.\n\nEssas parcelas cabem no seu orçamento mensal? 😊'
        : 'TÁTICA SUGERIDA (PEDIDO DE MAIS PARCELAS):\n\n1. Concessão: "Posso estender o prazo, mantendo o desconto."\n2. Oferta: R$ 840,00 em 5x de R$ 168,00 sem juros.\n3. Fechamento: "Esse valor cabe no seu orçamento mensal?"\n4. Plano B: Se pedir 6x, ofereça R$ 140/mês.',
    }),
  },

  // ── Promise to pay (future date) ─────────────────────────────────────────
  {
    id: 'promessa_futura',
    detect: (msg) => /(?:dia|recebo|receber|salário|pagamento)\s+(?:dia\s+)?(\d{1,2})|(?:mês|mes)\s+que\s+vem|próxim[oa]\s+mês|aguarde|segura|espera|adiar/i.test(msg),
    build: (userRole) => ({
      intent: 'Promessa de Pagamento Futuro',
      sentiment: 'colaborativo',
      nluThought: 'Cliente promete pagamento em data futura específica. Intenção positiva.',
      proposal: buildProposal({}),
      motorThought: 'Promessa de pagamento detectada. Mantendo proposta padrão com data agendada.',
      motorTools: [
        { name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 },
        { name: 'schedule_payment_reminder', payload: '{ date_offset_days: 14 }', status: 200 },
      ],
      motorRag: [RAG_POLICY],
      empatiaThought: `Confirmando agendamento amigável para persona [${userRole}].`,
      guardiaoThought: 'L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=APROVADO | Risco: BAIXO | Acordo de boa-fé.',
      guardiaoRag: [RAG_CDC_42],
      complianceStatus: 'APROVADO',
      complianceRisk: 'BAIXO',
      response: userRole === 'CUSTOMER'
        ? 'Sem problema, João! Vou agendar aqui um lembrete para o dia que você combinou. Posso já te enviar o boleto de R$ 840,00 (3x de R$ 280,00) com vencimento alinhado com seu recebimento?\n\nDessa forma, fica tudo organizado.'
        : 'TÁTICA SUGERIDA (PROMESSA DE PAGAMENTO):\n\n1. Boa-fé: "Vamos agendar para a data que combinou."\n2. Compromisso registrado: Pré-aceitar a proposta no sistema com vencimento custom.\n3. Lembrete: Ativar reminder para 1 dia antes da data prometida.\n4. Hedge: "Se algo mudar, me chama com antecedência."',
    }),
  },

  // ── Customer challenges the debt ────────────────────────────────────────
  {
    id: 'questiona_divida',
    detect: (msg) => /não\s+devo|não\s+reconheço|esse\s+valor\s+está\s+errado|cobrança\s+indevida|nunca\s+contratei|fraude/i.test(msg),
    build: (userRole) => ({
      intent: 'Contestação de Dívida',
      sentiment: 'ansioso',
      nluThought: 'Cliente questiona a validade da dívida. Necessário oferecer canal formal de contestação.',
      proposal: null,
      motorThought: 'Cliente contesta dívida. Bloqueando proposta de acordo. Encaminhando para verificação documental.',
      motorTools: [
        { name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 },
        { name: 'request_dispute_review', payload: '{ debt_id: "D-9982", reason: "customer_dispute" }', status: 200 },
      ],
      motorRag: [{ source: 'manual_disputas.pdf', snippet: 'Toda contestação deve ser registrada e respondida em até 5 dias úteis.' }],
      empatiaThought: `Compondo resposta acolhedora com instrução clara para persona [${userRole}].`,
      guardiaoThought: 'L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=APROVADO | Risco: BAIXO | Tom respeitoso, oferece canal formal.',
      guardiaoRag: [RAG_CDC_42],
      complianceStatus: 'APROVADO',
      complianceRisk: 'BAIXO',
      response: userRole === 'CUSTOMER'
        ? 'João, entendo sua preocupação e sua contestação é totalmente válida. Vou registrar agora e nossa equipe vai analisar o histórico completo do seu contrato em até 5 dias úteis.\n\nVocê receberá um e-mail com toda a documentação. Pode me enviar mais detalhes do que você acredita estar incorreto?'
        : 'TÁTICA SUGERIDA (CONTESTAÇÃO DE DÍVIDA):\n\n1. Acolhimento: "Sua contestação é válida e será analisada."\n2. Registro: Abrir ticket de disputa no sistema agora.\n3. SLA: Informar prazo de 5 dias úteis para resposta.\n4. Coleta: "Pode me detalhar o que está incorreto?"\n5. CRÍTICO: NÃO insistir em cobrança enquanto disputa está aberta.',
    }),
  },

  // ── Default: standard discount request ──────────────────────────────────
  {
    id: 'default',
    detect: () => true,
    build: (userRole) => ({
      intent: 'Pedido de Desconto / Dificuldade Financeira',
      sentiment: 'ansioso',
      nluThought: 'Pedido padrão de negociação. Sentimento ansioso mas colaborativo.',
      proposal: buildProposal({}),
      motorThought: 'Aplicando desconto máximo da alçada (30%) em 3 parcelas.',
      motorTools: [
        { name: 'get_debt_status', payload: "{ debt_id: 'D-9982' }", status: 200 },
        { name: 'get_politicas_desconto', payload: '{ days_overdue: 45 }', status: 200 },
        { name: 'calculate_amortization', payload: '{ principal: 1200, discount: 0.3, installments: 3 }', status: 200 },
      ],
      motorRag: [RAG_POLICY],
      empatiaThought: `Formato amigável para persona [${userRole}].`,
      guardiaoThought: 'L0:leakage✓ → L1:regex✓ → L2:clean → L3:llm-judge=APROVADO | Risco: BAIXO | Oferta clara, tom positivo.',
      guardiaoRag: [RAG_CDC_42],
      complianceStatus: 'APROVADO',
      complianceRisk: 'BAIXO',
      response: userRole === 'CUSTOMER'
        ? 'Entendo perfeitamente, João! Consegui aplicar nosso desconto máximo: o valor cai para R$ 840,00 e podemos dividir em 3x de R$ 280,00 sem juros.\n\nFica melhor para o seu bolso? 😊'
        : 'TÁTICA SUGERIDA (PEDIDO PADRÃO):\n\n1. Empatia: "Entendo o momento — vamos encontrar uma saída."\n2. Oferta Máxima: R$ 840,00 (30% off) em 3x de R$ 280,00.\n3. Argumento: "Sem juros, e parcelas no mesmo valor da original."\n4. Fechamento: "Esse formato cabe no orçamento?"',
    }),
  },
]

// ─── Public API ──────────────────────────────────────────────────────────────

export function detectScenario(message, history = []) {
  for (const scenario of SCENARIOS) {
    if (scenario.detect(message, history)) {
      return scenario
    }
  }
  return SCENARIOS[SCENARIOS.length - 1]
}

export function buildScenarioOutput(scenario, userRole) {
  return {
    ...scenario.build(userRole),
    id: scenario.id,
    triggerSelfCorrection: scenario.triggerSelfCorrection || false,
  }
}

export { simAgentMetrics }
