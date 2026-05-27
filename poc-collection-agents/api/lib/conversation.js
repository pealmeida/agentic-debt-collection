/**
 * Conversation memory helpers.
 *
 * The pipeline is stateless per request: the only record of prior turns is the
 * `history` array ([{ role, text }]) the frontend replays. NLU already reads it,
 * but Motor and Empatia were blind to it — so on a follow-up turn the Motor
 * recomputed a fresh default proposal and Empatia drifted in tone, breaking
 * consistency across the conversation (e.g. customer accepts "6x de R$ 140" and
 * the bot confirms "3x de R$ 280").
 *
 * These helpers recover the last assistant turn and parse the concrete proposal
 * out of its text so downstream agents can carry the same numbers forward.
 */

/** Returns the text of the most recent assistant message, or '' if none. */
export function lastAgentText(history = []) {
  for (let i = history.length - 1; i >= 0; i--) {
    const role = history[i]?.role
    if (role === 'ai' || role === 'assistant') return String(history[i].text || '')
  }
  return ''
}

/** Parses a Brazilian currency string ("1.200,00", "840", "R$ 280,50") → Number. */
function parseBrlNumber(raw) {
  if (raw == null) return null
  const cleaned = String(raw)
    .replace(/[^\d.,]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Extracts a proposal from free-text like:
 *   "R$ 840,00 em 6x de R$ 140,00"
 *   "3x de R$ 280 sem juros"
 *   "R$ 840,00 à vista"
 * Returns { total, installments, installment_value } when at least the total or
 * an installment plan is recognizable, else null.
 */
export function parseProposalFromText(text) {
  if (!text) return null

  // "à vista" / "à-vista" with no installment plan implies a single payment.
  const isAvista = /[àa]\s*vista\b/i.test(text)

  // Match the plan + per-installment value together so the value is the one
  // that FOLLOWS the "Nx" token — not an earlier "de R$ ..." used for contrast
  // (e.g. "liberar de R$ 1.200 por R$ 840 em 3x de R$ 280").
  const planMatch = text.match(/(\d{1,2})\s*(?:x|parcelas?|vezes)\b[^R\d]*R\$\s*([\d.]+(?:,\d{2})?)/i)
  const bareInstallments = text.match(/(\d{1,2})\s*(?:x|parcelas?|vezes)\b/i)
  const installments = planMatch ? Number(planMatch[1]) : bareInstallments ? Number(bareInstallments[1]) : null
  const installmentValue = planMatch ? parseBrlNumber(planMatch[2]) : null

  // The leading "R$ ..." is the discounted total when no plan value is present.
  const currencyValues = [...text.matchAll(/R\$\s*([\d.]+(?:,\d{2})?)/gi)].map((m) => parseBrlNumber(m[1]))
  const total = currencyValues.length ? currencyValues[0] : null

  const resolvedInstallments = installments ?? (isAvista ? 1 : null)

  // When both the plan and per-installment value are known, the deal total is
  // installments × value — more reliable than the first "R$ ..." in the text,
  // which is often the *original* amount cited for contrast (e.g. "de R$ 1.200
  // por R$ 840 em 3x de R$ 280").
  const resolvedTotal = resolvedInstallments && installmentValue != null
    ? Math.round(resolvedInstallments * installmentValue * 100) / 100
    : total

  if (resolvedTotal == null && resolvedInstallments == null) return null

  return {
    total: resolvedTotal,
    installments: resolvedInstallments,
    installment_value: installmentValue,
  }
}

/** Counts how many assistant turns already carried a concrete proposal. */
export function countPriorOffers(history = []) {
  return history.filter(
    (m) => (m?.role === 'ai' || m?.role === 'assistant') && parseProposalFromText(m.text),
  ).length
}

/**
 * Two-tier discount ladder anchored on the full price. The alçada ceiling is the
 * FINAL concession, never the opening bid:
 *   - first offer (priorOfferCount === 0) → smaller discount (~half ceiling) to attract;
 *   - any follow-up → the ceiling, to avoid losing the deal.
 * Floors the opening tier at 5% so even a low ceiling still reads as an offer.
 */
export function tieredDiscount(priorOfferCount, ceiling) {
  if (priorOfferCount > 0) return ceiling
  return Math.round(Math.max(0.05, ceiling * 0.5) * 100) / 100
}
