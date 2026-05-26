import { useState, useEffect } from 'react'
import { X, Key, Eye, EyeOff, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react'

export function SettingsModal({ onClose }) {
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  useEffect(() => {
    try {
      setApiKey(localStorage.getItem('openrouter_byok_key') || '')
    } catch { /* ignore */ }
  }, [])

  function handleSave() {
    try {
      if (apiKey.trim()) {
        localStorage.setItem('openrouter_byok_key', apiKey.trim())
      } else {
        localStorage.removeItem('openrouter_byok_key')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ }
  }

  function handleClear() {
    setApiKey('')
    try {
      localStorage.removeItem('openrouter_byok_key')
    } catch { /* ignore */ }
    setTestResult(null)
  }

  async function handleTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const headers = {}
      const keyToTest = apiKey.trim()
      if (keyToTest) headers['x-byok-key'] = keyToTest

      const res = await fetch('/api/healthz', { headers })
      const data = await res.json()
      setTestResult({ ok: data.ok, model: data.model, has_key: data.has_key })
    } catch (err) {
      setTestResult({ ok: false, error: err.message })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="font-bold text-slate-900">Configurações — OpenRouter</h2>
          <button type="button" onClick={onClose} className="btn-interactive min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 text-sm text-brand-800 space-y-1">
            <p className="font-semibold">Modo BYOK (Bring Your Own Key)</p>
            <p className="text-brand-700">Insira sua chave OpenRouter para usar seus próprios créditos. A chave fica no localStorage do seu navegador e é enviada via header — nunca no servidor.</p>
            <a
              href="https://openrouter.ai/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand-600 font-semibold hover:underline mt-1"
            >
              Obter chave em openrouter.ai <ExternalLink size={12} />
            </a>
          </div>

          <div className="space-y-2">
            <label htmlFor="api-key-input" className="text-sm font-semibold text-slate-700 flex items-center gap-1.5">
              <Key size={14} /> Chave OpenRouter
            </label>
            <div className="relative">
              <input
                id="api-key-input"
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="w-full pl-4 pr-12 min-h-[44px] rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="btn-interactive absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={showKey ? 'Ocultar chave' : 'Mostrar chave'}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <p className="text-xs text-slate-500">
              Deixe em branco para usar a chave do servidor (se configurada). Sem nenhuma chave, a POC roda em modo simulação.
            </p>
          </div>

          {testResult && (
            <div className={`flex items-start gap-2 text-sm rounded-xl p-3 border ${testResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
              {testResult.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
              <div>
                {testResult.ok
                  ? `Conexão OK! Modelo: ${testResult.model}. Chave: ${testResult.has_key ? 'configurada' : 'não configurada (simulação)'}.`
                  : `Erro: ${testResult.error || 'falha na conexão'}`}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 px-6 pb-6">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing}
            className="btn-interactive flex-1 min-h-[44px] rounded-xl border border-slate-300 text-slate-700 font-semibold text-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {testing ? 'Testando...' : 'Testar conexão'}
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="btn-interactive min-h-[44px] px-4 rounded-xl border border-red-200 text-red-600 font-semibold text-sm hover:bg-red-50"
          >
            Limpar
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="btn-interactive flex-1 min-h-[44px] rounded-xl bg-brand-600 text-white font-semibold text-sm hover:bg-brand-700"
          >
            {saved ? '✓ Salvo!' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  )
}
