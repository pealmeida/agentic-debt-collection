#!/usr/bin/env node
/**
 * Scenario sweep — runs EVERY demo prompt (the UI suggestion chips, both
 * personas, plus the multi-turn acceptance) through the real OpenRouter
 * pipeline, mirroring api/orchestrate.js exactly: security gate → NLU → Motor
 * → Empatia → Guardião with the self-correction loop.
 *
 * Purpose: confirm the canned scenarios produce realistic, compliant, on-tone
 * responses so they're a sound basis for model-optimization work (profile
 * tuning, latency/cost budgets, prompt iteration).
 *
 * Per scenario it reports: block status, intent, sentiment, proposal, compliance
 * status/risk, self-corrections, forbidden-word leakage, plus tokens / latency /
 * cost. Quality issues are flagged (✗ hard fail, ! soft warning).
 *
 * Usage:
 *   node scripts/scenario-sweep.mjs                 # active profile (balanced-cost)
 *   OPENROUTER_MODEL_PROFILE=openai-blend node scripts/scenario-sweep.mjs
 *
 * Requires OPENROUTER_API_KEY (read from .env). Cost: ~$0.01-0.02 per profile.
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { resolveAgent, getSelfCorrection, getActiveProfileId, estimateCostUsd } from '../api/lib/harness.js'
import { runSecurityGate } from '../api/lib/security.js'
import * as nlu from '../api/lib/agents/nlu.js'
import * as motor from '../api/lib/agents/motor.js'
import * as empatia from '../api/lib/agents/empatia.js'
import * as guardiao from '../api/lib/agents/guardiao.js'
import { SUGGESTIONS, MOCK_CRM_CASE } from '../src/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

// ─── Minimal .env loader (no extra deps) ─────────────────────────────────────
function loadDotEnv() {
  const path = join(PROJECT_ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq <= 0) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1)
    if (!process.env[key]) process.env[key] = val
  }
}
loadDotEnv()

if (!process.env.OPENROUTER_API_KEY) {
  console.error('✗ OPENROUTER_API_KEY missing. Set it in .env or shell.')
  process.exit(2)
}

const openrouter = { apiKey: process.env.OPENROUTER_API_KEY, baseUrl: 'https://openrouter.ai/api/v1' }

// Forbidden vocabulary the Guardião L1 regex enforces (api/lib/tools.js). The
// final output must never contain these, regardless of persona.
const FORBIDDEN = ['sujar nome', 'processo', 'penhora', 'polícia', 'delegacia', 'prisão', 'ameaça', 'coação']

const AGENT_RUNNERS = {
  agente_escuta_nlu: nlu,
  agente_motor_acordo: motor,
  agente_empatia_copywriter: empatia,
  agente_guardiao_compliance: guardiao,
}

// ─── Colors ──────────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY
const c = {
  dim: (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (tty ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s) => (tty ? `\x1b[36m${s}\x1b[0m` : s),
}

// ─── Pipeline runner — mirrors api/orchestrate.js (sans HTTP/SSE) ────────────
async function runPipeline({ userRole, message, history }) {
  const securityResult = runSecurityGate(message, history)
  if (!securityResult.safe && securityResult.highestSeverity === 'HIGH') {
    return { blocked: true, threats: securityResult.threats.map((t) => t.threat) }
  }

  const maxSelfCorrections = getSelfCorrection()?.max_attempts ?? 2
  const state = {
    user_role: userRole,
    message,
    history,
    debt_data: MOCK_CRM_CASE,
    detected_intent: null,
    sentiment: null,
    nlu_summary: null,
    calculated_proposal: null,
    motor_tactic_note: null,
    motor_reason: null,
    debt_info: null,
    policy_info: null,
    draft_response: null,
    compliance_status: null,
    compliance_feedback: null,
    compliance_risk: null,
    final_response: null,
    correction_feedback: null,
    security_threats: securityResult.safe ? [] : securityResult.threats,
    security_severity: securityResult.safe ? null : securityResult.highestSeverity,
  }

  const runs = []
  let cost = 0
  async function runAgent(id) {
    const resolved = resolveAgent(id)
    const { patch, trace } = await AGENT_RUNNERS[id].run(state, { agent: resolved, openrouter })
    Object.assign(state, patch)
    const agentCost = estimateCostUsd(resolved, trace.usage)
    cost += agentCost
    runs.push({ id, model: resolved.model, tokens: trace.tokens || 0, latency_ms: trace.latency_ms || 0, cost: agentCost })
  }

  await runAgent('agente_escuta_nlu')
  await runAgent('agente_motor_acordo')

  let approved = false
  let selfCorrections = 0
  let forcedApproval = false
  while (!approved && selfCorrections <= maxSelfCorrections) {
    await runAgent('agente_empatia_copywriter')
    await runAgent('agente_guardiao_compliance')
    if (state.compliance_status === 'APROVADO') {
      approved = true
    } else if (selfCorrections < maxSelfCorrections) {
      selfCorrections++
      state.correction_feedback = state.compliance_feedback
    } else {
      state.compliance_status = 'APROVADO'
      state.draft_response = (state.draft_response || '') + '\n\n[Nota: Texto revisado pelo Guardião de Compliance.]'
      approved = true
      forcedApproval = true
    }
  }
  state.final_response = state.draft_response

  return {
    blocked: false,
    state,
    runs,
    selfCorrections,
    forcedApproval,
    tokens: runs.reduce((a, r) => a + r.tokens, 0),
    latency_ms: runs.reduce((a, r) => a + r.latency_ms, 0),
    cost,
  }
}

// ─── Quality verifier ────────────────────────────────────────────────────────
function verify(result, { userRole, security }) {
  const fails = []
  const warns = []
  if (result.blocked) {
    if (!security) fails.push(`unexpectedly blocked (${result.threats.join(', ')})`)
    return { fails, warns }
  }
  if (security) {
    fails.push('expected a security block, but the pipeline ran')
    return { fails, warns }
  }

  const s = result.state
  const out = (s.final_response || '').toLowerCase()

  if (s.compliance_status !== 'APROVADO') fails.push(`compliance != APROVADO (${s.compliance_status})`)
  for (const w of FORBIDDEN) if (out.includes(w)) fails.push(`forbidden word leaked: "${w}"`)
  if ((s.final_response || '').trim().length < 40) fails.push('response suspiciously short (<40 chars)')
  if (result.forcedApproval) warns.push('force-approved after exhausting self-corrections (degraded output)')

  // Proposal math sanity (when one was produced).
  if (s.calculated_proposal) {
    const p = s.calculated_proposal
    const expectedTotal = Math.round(MOCK_CRM_CASE.total_amount * (1 - p.discount_rate) * 100) / 100
    if (Math.abs(expectedTotal - p.total) > 0.01) fails.push(`Motor math drift: expected ${expectedTotal}, got ${p.total}`)
    if (p.discount_rate > 0.6 + 1e-9) fails.push(`discount ${p.discount_rate} exceeds max alçada 0.60`)
  }

  // Persona-format realism.
  if (userRole === 'AGENT' && s.calculated_proposal === null && !/[•\-\d]/.test(s.final_response || '')) {
    warns.push('AGENT output lacks operational structure (no bullets/steps)')
  }
  if (result.selfCorrections > 0) warns.push(`${result.selfCorrections} self-correction(s)`)

  return { fails, warns }
}

// ─── Build the scenario list from the actual UI chips ────────────────────────
// Security chips are flagged so the verifier expects a block.
const SECURITY_LABELS = new Set(['🛡️ Injection', '🛡️ Jailbreak', '🛡️ Tentativa jailbreak'])
// The acceptance chip only makes sense as a 2nd turn, after a proposal.
const ACCEPTANCE_LABELS = new Set(['Aceito acordo'])

function buildScenarios() {
  const list = []
  for (const role of ['CUSTOMER', 'AGENT']) {
    for (const chip of SUGGESTIONS[role]) {
      list.push({
        role,
        label: chip.label,
        message: chip.text,
        security: SECURITY_LABELS.has(chip.label),
        acceptance: ACCEPTANCE_LABELS.has(chip.label),
      })
    }
  }
  return list
}

function fmt(n, w) { return String(n).padStart(w) }

async function main() {
  const profileId = getActiveProfileId()
  const scenarios = buildScenarios()

  console.log(c.bold(`\n━━━ Scenario sweep — every demo chip through the real pipeline ━━━`))
  console.log(`profile: ${c.cyan(profileId)}   scenarios: ${scenarios.length}\n`)

  let hardFails = 0
  let softWarns = 0
  let totalCost = 0
  const rows = []

  for (const sc of scenarios) {
    process.stdout.write(c.dim(`· [${sc.role.padEnd(8)}] ${sc.label} … `))

    // Seed a prior proposal turn for the acceptance scenario.
    let history = []
    if (sc.acceptance) {
      const seedMsg = 'As parcelas estão pesadas. Não conseguem fazer em 5 ou 6 vezes?'
      const seed = await runPipeline({ userRole: sc.role, message: seedMsg, history: [] })
      history = [
        { role: 'user', text: seedMsg },
        { role: 'ai', text: seed.state?.final_response || 'Posso oferecer R$ 840 em 5x de R$ 168.' },
      ]
    }

    let result
    try {
      result = await runPipeline({ userRole: sc.role, message: sc.message, history })
    } catch (err) {
      console.log(c.red(`PIPELINE ERROR: ${err.message}`))
      hardFails++
      rows.push({ sc, error: err.message })
      continue
    }

    const { fails, warns } = verify(result, sc)
    hardFails += fails.length
    softWarns += warns.length
    totalCost += result.cost || 0

    let status
    if (result.blocked) status = c.cyan('BLOCKED')
    else if (fails.length) status = c.red(`FAIL(${fails.length})`)
    else if (warns.length) status = c.yellow(`OK!(${warns.length})`)
    else status = c.green('OK')

    const meta = result.blocked
      ? c.dim(`[${result.threats.join(', ')}]`)
      : c.dim(`${fmt(result.tokens, 5)}tok ${fmt(Math.round(result.latency_ms), 6)}ms $${(result.cost).toFixed(5)} corr=${result.selfCorrections}`)
    console.log(`${status}  ${meta}`)

    rows.push({ sc, result, fails, warns })
  }

  // ── Detailed report ──────────────────────────────────────────────────────
  console.log(c.bold('\n━━━ Details ━━━'))
  for (const { sc, result, fails = [], warns = [], error } of rows) {
    if (error) {
      console.log(`\n${c.red('✗')} [${sc.role}] ${sc.label} — ERROR: ${error}`)
      continue
    }
    if (result.blocked) {
      console.log(`\n${c.cyan('⛔')} [${sc.role}] ${sc.label} — blocked: ${result.threats.join(', ')}`)
      continue
    }
    const s = result.state
    const icon = fails.length ? c.red('✗') : warns.length ? c.yellow('!') : c.green('✓')
    console.log(`\n${icon} [${sc.role}] ${c.bold(sc.label)}`)
    console.log(c.dim(`    msg: "${sc.message}"`))
    console.log(c.dim(`    intent: ${s.detected_intent} | sentiment: ${s.sentiment} | risk: ${s.compliance_risk || '—'} | status: ${s.compliance_status}`))
    if (s.calculated_proposal) {
      const p = s.calculated_proposal
      console.log(c.dim(`    proposal: R$ ${p.total} (${p.desconto || Math.round(p.discount_rate * 100) + '%'}) em ${p.installments}x de R$ ${p.installment_value}`))
    } else {
      console.log(c.dim(`    proposal: (none — ${s.motor_reason ? s.motor_reason.slice(0, 70) : 'blocked by Motor'})`))
    }
    const reply = (s.final_response || '').replace(/\s+/g, ' ').slice(0, 200)
    console.log(c.dim(`    reply: "${reply}${reply.length === 200 ? '…' : ''}"`))
    for (const f of fails) console.log(`    ${c.red('✗')} ${f}`)
    for (const w of warns) console.log(`    ${c.yellow('!')} ${w}`)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const clean = rows.filter((r) => !r.error && (r.fails?.length || 0) === 0).length
  console.log(c.bold('\n━━━ Summary ━━━'))
  console.log(`scenarios: ${clean}/${rows.length} without hard failures`)
  console.log(`hard failures: ${hardFails} | soft warnings: ${softWarns}`)
  console.log(`total OpenRouter spend: $${totalCost.toFixed(5)}`)

  const pipelineRuns = rows.filter((r) => r.result && !r.result.blocked)
  if (pipelineRuns.length) {
    const avgTok = Math.round(pipelineRuns.reduce((a, r) => a + r.result.tokens, 0) / pipelineRuns.length)
    const avgLat = Math.round(pipelineRuns.reduce((a, r) => a + r.result.latency_ms, 0) / pipelineRuns.length)
    const avgCost = pipelineRuns.reduce((a, r) => a + r.result.cost, 0) / pipelineRuns.length
    console.log(c.dim(`avg per full turn: ${avgTok} tok, ${avgLat}ms, $${avgCost.toFixed(5)}`))
  }

  process.exit(hardFails > 0 ? 1 : 0)
}

main().catch((err) => { console.error(err); process.exit(1) })
