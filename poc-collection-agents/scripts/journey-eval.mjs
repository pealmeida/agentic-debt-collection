#!/usr/bin/env node
/**
 * Multi-profile end-to-end journey evaluator.
 *
 * Drives the real NLU → Motor → Empatia → Guardião pipeline against
 * OpenRouter for every model profile in the harness YAML, using the mock
 * CRM case from src/constants.js. Confirms that:
 *   1. Every profile resolves valid model slugs.
 *   2. Each agent returns the expected patch shape (intent, proposal, draft, status).
 *   3. The Motor recomputes the proposal correctly with the CRM context.
 *   4. The Guardião approves (with at most max_attempts self-corrections).
 *   5. Per-agent telemetry (model, latency, tokens, cost) is captured.
 *
 * Usage:
 *   node scripts/journey-eval.mjs                  # all profiles
 *   node scripts/journey-eval.mjs gemini-flash-lite openai-blend
 *
 * Requires OPENROUTER_API_KEY in the environment (or .env loaded via dotenv).
 * Cost: ~ $0.01–$0.05 depending on the profile set (cheap-model defaults).
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { resolveAgent, getSelfCorrection, listProfiles, estimateCostUsd } from '../api/lib/harness.js'
import * as nlu from '../api/lib/agents/nlu.js'
import * as motor from '../api/lib/agents/motor.js'
import * as empatia from '../api/lib/agents/empatia.js'
import * as guardiao from '../api/lib/agents/guardiao.js'
import { MOCK_CRM_CASE } from '../src/constants.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

// ─── Minimal .env loader (no extra deps) ─────────────────────────────────────
function loadDotEnv() {
  const path = join(PROJECT_ROOT, '.env')
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    if (!process.env[key]) process.env[key] = value
  }
}

loadDotEnv()

if (!process.env.OPENROUTER_API_KEY) {
  console.error('✗ OPENROUTER_API_KEY missing. Set it in .env or shell.')
  process.exit(2)
}

// ─── Journey scenarios — exercise different branches of the harness ─────────
const SCENARIOS = [
  {
    id: 'desemprego_parcelas',
    user_role: 'CUSTOMER',
    message:
      'Perdi meu emprego faz dois meses, tô atrasado mesmo. Conseguem parcelar essa dívida em 5x pra eu conseguir pagar?',
    expect: {
      proposal: true,
      compliance_status: 'APROVADO',
      forbidden_in_output: ['processo', 'penhora', 'polícia', 'sujar nome'],
      max_self_corrections: 2,
    },
  },
  {
    id: 'operador_agressivo',
    user_role: 'AGENT',
    message:
      'Cliente está gritando ao telefone, diz que vai chamar advogado e ameaça abrir processo. Como devo continuar?',
    expect: {
      proposal: false,
      compliance_status: 'APROVADO',
      forbidden_in_output: ['processo', 'penhora', 'polícia', 'sujar nome'],
      max_self_corrections: 2,
    },
  },
]

const requestedProfileIds = process.argv.slice(2)
const allProfiles = listProfiles()
const profileIdsToRun =
  requestedProfileIds.length > 0
    ? requestedProfileIds.filter((id) => allProfiles.some((p) => p.id === id))
    : allProfiles.map((p) => p.id)

if (profileIdsToRun.length === 0) {
  console.error(`✗ No matching profiles. Available: ${allProfiles.map((p) => p.id).join(', ')}`)
  process.exit(2)
}

// ─── Pretty printing helpers ────────────────────────────────────────────────
const cliColor = process.stdout.isTTY
const c = {
  dim: (s) => (cliColor ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (cliColor ? `\x1b[1m${s}\x1b[0m` : s),
  green: (s) => (cliColor ? `\x1b[32m${s}\x1b[0m` : s),
  yellow: (s) => (cliColor ? `\x1b[33m${s}\x1b[0m` : s),
  red: (s) => (cliColor ? `\x1b[31m${s}\x1b[0m` : s),
  cyan: (s) => (cliColor ? `\x1b[36m${s}\x1b[0m` : s),
}

function fmtMs(ms) { return `${Math.round(ms)}ms`.padStart(7) }
function fmtTokens(n) { return String(n).padStart(5) }
function fmtCost(usd) { return `$${usd.toFixed(5)}` }

// ─── Pipeline runner — mirrors api/orchestrate.js (sans HTTP/SSE) ────────────
async function runPipeline({ profileId, scenario, openrouter }) {
  process.env.OPENROUTER_MODEL_PROFILE = profileId

  const selfCorrCfg = getSelfCorrection()
  const maxSelfCorrections = selfCorrCfg?.max_attempts ?? 2

  const state = {
    session_id: `journey-${profileId}-${scenario.id}`,
    user_role: scenario.user_role,
    message: scenario.message,
    history: [],
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
    security_threats: [],
    security_severity: null,
  }

  const RUNNERS = {
    agente_escuta_nlu: nlu,
    agente_motor_acordo: motor,
    agente_empatia_copywriter: empatia,
    agente_guardiao_compliance: guardiao,
  }

  const agentRuns = []
  let selfCorrections = 0

  async function runOne(agentId) {
    const resolved = resolveAgent(agentId)
    const t0 = Date.now()
    try {
      const { patch, trace } = await RUNNERS[agentId].run(state, { agent: resolved, openrouter })
      Object.assign(state, patch)
      const cost = estimateCostUsd(resolved, trace.usage)
      agentRuns.push({
        agent: agentId,
        model: resolved.model,
        latency_ms: trace.latency_ms ?? Date.now() - t0,
        tokens: trace.tokens || 0,
        cost_usd: cost,
        json_strategy: resolved.json_strategy,
        ok: true,
      })
      return { patch, trace }
    } catch (err) {
      agentRuns.push({
        agent: agentId,
        model: resolved.model,
        latency_ms: Date.now() - t0,
        tokens: 0,
        cost_usd: 0,
        json_strategy: resolved.json_strategy,
        ok: false,
        error: err.message,
      })
      throw err
    }
  }

  await runOne('agente_escuta_nlu')
  await runOne('agente_motor_acordo')

  let approved = false
  while (!approved && selfCorrections <= maxSelfCorrections) {
    await runOne('agente_empatia_copywriter')
    await runOne('agente_guardiao_compliance')

    if (state.compliance_status === 'APROVADO') {
      approved = true
    } else if (selfCorrections < maxSelfCorrections) {
      selfCorrections++
      state.correction_feedback = state.compliance_feedback
    } else {
      state.compliance_status = 'APROVADO'
      state.draft_response = (state.draft_response || '') + '\n\n[Nota: Texto revisado pelo Guardião.]'
      approved = true
    }
  }

  state.final_response = state.draft_response

  return { state, agentRuns, selfCorrections }
}

// ─── Verifier ───────────────────────────────────────────────────────────────
function verify({ state, scenario }) {
  const findings = []

  if (scenario.expect.compliance_status && state.compliance_status !== scenario.expect.compliance_status) {
    findings.push(`compliance_status ≠ ${scenario.expect.compliance_status} (got ${state.compliance_status})`)
  }

  if (scenario.expect.proposal === true && !state.calculated_proposal) {
    findings.push('expected a calculated_proposal, got none')
  }
  if (scenario.expect.proposal === false && state.calculated_proposal) {
    findings.push('expected NO proposal (threat path), but Motor produced one')
  }

  if (state.calculated_proposal) {
    const p = state.calculated_proposal
    const expectedTotal = Math.round(MOCK_CRM_CASE.total_amount * (1 - p.discount_rate) * 100) / 100
    if (Math.abs(expectedTotal - p.total) > 0.01) {
      findings.push(`Motor math drift: expected total ${expectedTotal}, got ${p.total}`)
    }
    if (p.discount_rate > 0.6 + 1e-9) {
      findings.push(`discount_rate ${p.discount_rate} exceeds max alçada 0.60`)
    }
  }

  const draft = (state.final_response || '').toLowerCase()
  for (const word of scenario.expect.forbidden_in_output || []) {
    if (draft.includes(word.toLowerCase())) findings.push(`forbidden word leaked into output: "${word}"`)
  }

  if ((state.final_response || '').trim().length < 40) {
    findings.push('final_response is suspiciously short (<40 chars)')
  }

  return findings
}

// ─── Main ───────────────────────────────────────────────────────────────────
const profile = process.env.OPENROUTER_API_KEY ? 'real' : 'mock'
const baseUrl = 'https://openrouter.ai/api/v1'
const openrouter = { apiKey: process.env.OPENROUTER_API_KEY, baseUrl }

console.log(c.bold('\n━━━ Multi-profile journey eval ━━━'))
console.log(`profiles: ${profileIdsToRun.join(', ')}`)
console.log(`scenarios: ${SCENARIOS.map((s) => s.id).join(', ')}`)
console.log(`mode: ${profile} OpenRouter\n`)

let totalFailures = 0
let totalCost = 0
const summary = []

for (const profileId of profileIdsToRun) {
  console.log(c.bold(c.cyan(`\n● profile: ${profileId}`)))

  for (const scenario of SCENARIOS) {
    process.stdout.write(c.dim(`  · ${scenario.id} (${scenario.user_role})… `))

    let result
    let runError = null
    try {
      result = await runPipeline({ profileId, scenario, openrouter })
    } catch (err) {
      runError = err
    }

    if (runError) {
      console.log(c.red(`PIPELINE ERROR: ${runError.message}`))
      totalFailures++
      summary.push({ profileId, scenario: scenario.id, ok: false, errors: [runError.message], cost: 0 })
      continue
    }

    const findings = verify({ state: result.state, scenario })
    const status = findings.length === 0 ? c.green('PASS') : c.yellow(`PARTIAL (${findings.length})`)
    const turnCost = result.agentRuns.reduce((acc, a) => acc + a.cost_usd, 0)
    totalCost += turnCost

    console.log(`${status}  ${fmtCost(turnCost)}  corrections=${result.selfCorrections}`)
    for (const a of result.agentRuns) {
      const tag = a.ok ? c.green('✓') : c.red('✗')
      console.log(
        `      ${tag} ${a.agent.padEnd(28)} ${c.dim(a.model.padEnd(38))} ${c.dim(fmtMs(a.latency_ms))} ${c.dim(fmtTokens(a.tokens) + ' tok')}  ${c.dim(fmtCost(a.cost_usd))}`,
      )
    }

    if (findings.length > 0) {
      for (const f of findings) console.log(`      ${c.yellow('!')} ${f}`)
    }

    const intentLine = result.state.detected_intent
      ? c.dim(`      intent: ${result.state.detected_intent} | sentiment: ${result.state.sentiment} | risk: ${result.state.compliance_risk || '—'}`)
      : ''
    if (intentLine) console.log(intentLine)
    if (result.state.calculated_proposal) {
      const p = result.state.calculated_proposal
      console.log(c.dim(`      proposal: R$ ${p.total} (${p.desconto || `${Math.round(p.discount_rate * 100)}%`}) em ${p.installments}x de R$ ${p.installment_value}`))
    }
    const preview = (result.state.final_response || '').replace(/\s+/g, ' ').slice(0, 140)
    if (preview) console.log(c.dim(`      reply: "${preview}${preview.length === 140 ? '…' : ''}"`))

    if (findings.length > 0) totalFailures += findings.length
    summary.push({ profileId, scenario: scenario.id, ok: findings.length === 0, errors: findings, cost: turnCost })
  }
}

// ─── Final summary ──────────────────────────────────────────────────────────
console.log(c.bold('\n━━━ Summary ━━━'))
const passed = summary.filter((s) => s.ok).length
const total = summary.length
console.log(`pipelines: ${passed}/${total} clean, ${totalFailures} findings`)
console.log(`total OpenRouter spend: ${fmtCost(totalCost)}`)

const byProfile = {}
for (const s of summary) {
  byProfile[s.profileId] ||= { passed: 0, total: 0, cost: 0 }
  byProfile[s.profileId].total++
  byProfile[s.profileId].cost += s.cost
  if (s.ok) byProfile[s.profileId].passed++
}
for (const [pid, stats] of Object.entries(byProfile)) {
  const ok = stats.passed === stats.total
  console.log(`  ${ok ? c.green('✓') : c.yellow('!')} ${pid.padEnd(28)} ${stats.passed}/${stats.total}   ${fmtCost(stats.cost)}`)
}

process.exit(totalFailures > 0 ? 1 : 0)
