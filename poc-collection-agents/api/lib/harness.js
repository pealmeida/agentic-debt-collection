import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

let _cachedHarness = null
let _cachedMtime = null

function loadHarness() {
  const harnessPath = join(__dirname, '../../config/harness_negotiator.yaml')
  const stat = readFileSync(harnessPath)
  const raw = stat.toString()

  // In dev, bust cache if file changed (simple length check)
  if (_cachedHarness && _cachedMtime === raw.length) return _cachedHarness

  const parsed = yaml.load(raw)
  _cachedHarness = parsed
  _cachedMtime = raw.length
  return parsed
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

export function getProviderConfig() {
  const h = loadHarness()
  return h.providers?.default || { type: 'openrouter', base_url: 'https://openrouter.ai/api/v1' }
}
