export default function handler(req, res) {
  const key = process.env.OPENROUTER_API_KEY
  const byokEnabled = process.env.ALLOW_BYOK === 'true'

  res.status(200).json({
    ok: true,
    model: process.env.OPENROUTER_DEFAULT_MODEL || 'openai/gpt-4o-mini blend',
    has_key: !!key,
    byok_enabled: byokEnabled,
    timestamp: new Date().toISOString(),
  })
}
