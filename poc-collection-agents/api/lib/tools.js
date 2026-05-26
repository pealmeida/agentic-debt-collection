/**
 * MCP tool contracts used by the agents.
 * Each function returns { result, source, snippet } so the Inspector can show
 * auditable context without exposing sensitive fields.
 */

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

export function getDebtStatus(debtData) {
  const debt = normalizeDebtData(debtData)

  if (!debt) {
    return {
      result: null,
      source: 'urn:mcp:crm:debt_status',
      snippet: 'Nenhum contexto de dívida foi fornecido pelo CRM/request. Motor não pode calcular proposta.',
    }
  }

  return {
    result: debt,
    source: 'urn:mcp:crm:debt_status',
    snippet: `Dívida ${debt.debt_id || 'sem-id'}: R$ ${debt.total_amount} com ${debt.days_overdue} dias de atraso. Produto: ${debt.product || 'não informado'}.`,
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

function normalizeDebtData(debtData) {
  if (!debtData || typeof debtData !== 'object') return null

  const totalAmount = Number(debtData.total_amount)
  const daysOverdue = Number(debtData.days_overdue)

  if (!Number.isFinite(totalAmount) || totalAmount <= 0) return null
  if (!Number.isFinite(daysOverdue) || daysOverdue < 0) return null

  return {
    debt_id: stringOrEmpty(debtData.debt_id),
    debtor_name: stringOrEmpty(debtData.debtor_name),
    total_amount: Math.round(totalAmount * 100) / 100,
    original_amount: Number.isFinite(Number(debtData.original_amount))
      ? Math.round(Number(debtData.original_amount) * 100) / 100
      : null,
    days_overdue: Math.round(daysOverdue),
    due_date: stringOrEmpty(debtData.due_date),
    product: stringOrEmpty(debtData.product),
    last_contact: stringOrEmpty(debtData.last_contact),
    previous_proposals: Array.isArray(debtData.previous_proposals) ? debtData.previous_proposals : [],
    status: stringOrEmpty(debtData.status) || 'UNKNOWN',
  }
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : ''
}
