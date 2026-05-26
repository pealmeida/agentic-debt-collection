/**
 * Mock MCP tools — deterministic responses that mirror what real MCP servers would return.
 * Each function returns { result, source, snippet } so the Inspector can show RAG context.
 *
 * When real MCP servers are implemented, swap these functions 1:1 — the contract is stable.
 */

const DEBT_DATABASE = {
  'D-9982': {
    debtor_name: 'João da Silva',
    cpf_masked: '***.***.123-**',
    total_amount: 1200.0,
    original_amount: 1000.0,
    days_overdue: 45,
    due_date: '2026-04-11',
    product: 'Crédito Pessoal',
    last_contact: '2026-05-10',
    previous_proposals: [],
    status: 'OVERDUE',
  },
}

const DISCOUNT_POLICIES = [
  { days_range: [0, 30], max_discount: 0.1, label: '10% — atraso leve' },
  { days_range: [31, 60], max_discount: 0.3, label: '30% — atraso moderado' },
  { days_range: [61, 120], max_discount: 0.45, label: '45% — atraso grave' },
  { days_range: [121, 999], max_discount: 0.6, label: '60% — em processo de write-off' },
]

const CDC_GUIDELINES = [
  {
    article: 'Art. 42 CDC',
    text: 'Na cobrança de débitos, o consumidor inadimplente não será exposto a ridículo, nem será submetido a qualquer tipo de constrangimento ou ameaça.',
    forbidden_patterns: ['sujar nome', 'processo', 'penhora', 'polícia', 'delegacia', 'prisão'],
  },
  {
    article: 'Art. 71 CDC',
    text: 'Utilizar, na cobrança de dívidas, de ameaça, coação, constrangimento físico ou moral constitui crime.',
    forbidden_patterns: ['ameaça', 'coação', 'chamar a polícia'],
  },
]

export function getDebtStatus(debtId) {
  const debt = DEBT_DATABASE[debtId] || DEBT_DATABASE['D-9982']
  return {
    result: debt,
    source: 'urn:mcp:crm:debt_status',
    snippet: `Dívida ${debtId}: R$ ${debt.total_amount} com ${debt.days_overdue} dias de atraso. Produto: ${debt.product}.`,
  }
}

export function getDiscountPolicy(daysOverdue) {
  const policy = DISCOUNT_POLICIES.find(
    (p) => daysOverdue >= p.days_range[0] && daysOverdue <= p.days_range[1],
  ) || DISCOUNT_POLICIES[DISCOUNT_POLICIES.length - 1]

  return {
    result: policy,
    source: 'urn:mcp:vector-store:politicas_desconto',
    snippet: `tabela_alcadas_2026.csv — ${daysOverdue} dias de atraso: ${policy.label}. Max desconto = ${policy.max_discount * 100}%.`,
  }
}

export function calculateAmortization({ principal, discount, installments = 1 }) {
  const discountedTotal = Math.round(principal * (1 - discount) * 100) / 100
  const installmentValue = Math.round((discountedTotal / installments) * 100) / 100

  return {
    result: {
      original: principal,
      discount_rate: discount,
      total: discountedTotal,
      installments,
      installment_value: installmentValue,
      desconto_label: `${Math.round(discount * 100)}%`,
    },
    source: 'skill:calculate_amortization',
    snippet: `Principal R$ ${principal} × (1 - ${discount}) = R$ ${discountedTotal} em ${installments}x de R$ ${installmentValue}.`,
  }
}

export function getCdcGuidelines() {
  return {
    result: CDC_GUIDELINES,
    source: 'urn:mcp:vector-store:cdc_guidelines',
    snippet: CDC_GUIDELINES.map((g) => `${g.article}: ${g.text.slice(0, 80)}...`).join(' | '),
  }
}

export function checkGuardrailViolations(text) {
  const lower = text.toLowerCase()
  const violations = []

  for (const guideline of CDC_GUIDELINES) {
    for (const pattern of guideline.forbidden_patterns) {
      if (lower.includes(pattern.toLowerCase())) {
        violations.push({ pattern, article: guideline.article })
      }
    }
  }

  return violations
}
