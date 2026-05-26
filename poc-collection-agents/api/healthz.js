import { getActiveProfile, getPipeline, listProfiles, resolveAgent } from './lib/harness.js'

export default function handler(req, res) {
  const key = process.env.OPENROUTER_API_KEY
  const profile = getActiveProfile()

  let agents = []
  try {
    agents = getPipeline().map((id) => {
      const r = resolveAgent(id)
      return {
        id,
        model: r.model,
        temperature: r.temperature,
        json_strategy: r.json_strategy,
        prompt_hints: r.prompt_hints,
      }
    })
  } catch (err) {
    agents = []
  }

  const envOverrideModel = process.env.OPENROUTER_DEFAULT_MODEL || null

  res.status(200).json({
    ok: true,
    has_key: !!key,
    timestamp: new Date().toISOString(),
    profile: profile
      ? { id: profile.id, label: profile.label, description: profile.description || null }
      : null,
    env_default_model_override: envOverrideModel,
    agents,
    available_profiles: listProfiles(),
    // Legacy field kept for backward compat with the old healthz contract.
    model: envOverrideModel || agents[0]?.model || 'unknown',
  })
}
