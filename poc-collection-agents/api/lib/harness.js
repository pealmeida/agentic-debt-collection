import { existsSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HARNESS_CANDIDATES = [
  // Vercel recommends process.cwd() for files included with Functions.
  join(process.cwd(), 'config/harness_negotiator.yaml'),
  // Local/Vite fallback when this module is loaded from api/lib.
  join(__dirname, '../../config/harness_negotiator.yaml'),
]

function getHarnessPath() {
  const path = HARNESS_CANDIDATES.find((candidate) => existsSync(candidate))
  if (!path) {
    throw new Error(`Harness YAML not found. Tried: ${HARNESS_CANDIDATES.join(', ')}`)
  }
  return path
}

let _cachedHarness = null
let _cachedMtimeMs = null

function loadHarness() {
  const harnessPath = getHarnessPath()
  // Use file mtime as cache key — robust across content changes that preserve length.
  const mtimeMs = statSync(harnessPath).mtimeMs
  if (_cachedHarness && _cachedMtimeMs === mtimeMs) return _cachedHarness

  const raw = readFileSync(harnessPath, 'utf8')
  _cachedHarness = yaml.load(raw)
  _cachedMtimeMs = mtimeMs
  return _cachedHarness
}

export function getHarness() {
  return loadHarness()
}

export function getAgent(id) {
  const h = loadHarness()
  const agent = h.agents.find((a) => a.id === id)
  if (!agent) throw new Error(`Agent not found in harness: ${id}`)
  return agent
}

export function getPipeline() {
  const h = loadHarness()
  return h.state_graph.pipeline
}

export function getSelfCorrection() {
  const h = loadHarness()
  return h.state_graph.self_correction || null
}

export function getGuardrails() {
  const h = loadHarness()
  const guardianAgent = h.agents.find((a) => a.id === 'agente_guardiao_compliance')
  return guardianAgent?.guardrails || []
}

export function getEvalScenarios() {
  const h = loadHarness()
  return h.evals?.scenarios || []
}

// ─── Model profile resolution ────────────────────────────────────────────────

/**
 * Returns the id of the active model profile.
 *
 * Precedence:
 *   1. env var OPENROUTER_MODEL_PROFILE (if it points at a defined profile)
 *   2. harness YAML `active_profile`
 *   3. first profile in `model_profiles` (deterministic by insertion order)
 *   4. null when no profiles are defined at all
 */
export function getActiveProfileId() {
  const h = loadHarness()
  const profiles = h.model_profiles || {}
  const profileIds = Object.keys(profiles)
  if (profileIds.length === 0) return null

  const envChoice = process.env.OPENROUTER_MODEL_PROFILE
  if (envChoice && profiles[envChoice]) return envChoice

  if (h.active_profile && profiles[h.active_profile]) return h.active_profile

  return profileIds[0]
}

export function getActiveProfile() {
  const h = loadHarness()
  const id = getActiveProfileId()
  if (!id) return null
  return { id, ...(h.model_profiles?.[id] || {}) }
}

export function listProfiles() {
  const h = loadHarness()
  const profiles = h.model_profiles || {}
  return Object.entries(profiles).map(([id, p]) => ({
    id,
    label: p.label || id,
    description: p.description || '',
    provider: p.provider || 'openrouter',
  }))
}

/**
 * Resolve the runtime configuration for an agent.
 *
 * Merge order (lowest → highest precedence):
 *   1. YAML agent base (model, temperature, system_prompt, schema, tools…)
 *   2. Active profile's per-agent overrides (model, temperature, json_strategy,
 *      prompt_hints, history_window, pricing)
 *   3. Env override OPENROUTER_DEFAULT_MODEL (legacy "blast every agent" knob)
 *
 * The agent runners ALWAYS consume the result of this function — never the raw
 * YAML — so adding a new provider only requires editing this file + openrouter.js.
 */
export function resolveAgent(id) {
  const base = getAgent(id)
  const profile = getActiveProfile()
  const profileAgent = profile?.agents?.[id] || {}

  const merged = {
    ...base,
    ...profileAgent,
    // Carry forward profile metadata for telemetry/UI.
    profile_id: profile?.id || null,
    json_strategy: profileAgent.json_strategy || 'schema_strict',
    prompt_hints: profileAgent.prompt_hints || 'openai_strict',
    history_window: profileAgent.history_window ?? base.history_window ?? 6,
    pricing: profileAgent.pricing || null,
  }

  // Legacy env knob still wins — useful for "force one model everywhere" debugging.
  const envModel = process.env.OPENROUTER_DEFAULT_MODEL
  if (envModel) {
    merged.model = envModel
    merged.model_overridden_by_env = true
  }

  return merged
}

/**
 * Estimate USD cost for a usage block on a resolved agent.
 * Falls back to a blended rate when per-token pricing is unavailable.
 */
export function estimateCostUsd(resolvedAgent, usage) {
  const promptTokens = usage?.prompt_tokens || 0
  const completionTokens = usage?.completion_tokens || 0
  const pricing = resolvedAgent?.pricing

  if (pricing?.input_per_1m_usd != null && pricing?.output_per_1m_usd != null) {
    return (promptTokens * pricing.input_per_1m_usd + completionTokens * pricing.output_per_1m_usd) / 1_000_000
  }

  // Fallback: legacy blended estimate (kept stable for telemetry).
  const totalTokens = promptTokens + completionTokens
  return (totalTokens / 1000) * 0.008
}
