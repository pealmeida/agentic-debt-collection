import { readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import yaml from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))
const HARNESS_PATH = join(__dirname, '../../config/harness_negotiator.yaml')

let _cachedHarness = null
let _cachedMtimeMs = null

function loadHarness() {
  // Use file mtime as cache key — robust across content changes that preserve length.
  const mtimeMs = statSync(HARNESS_PATH).mtimeMs
  if (_cachedHarness && _cachedMtimeMs === mtimeMs) return _cachedHarness

  const raw = readFileSync(HARNESS_PATH, 'utf8')
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
