import { useState, useEffect } from 'react'
import { Zap, BarChart2, Code2, Clock, Cpu, TrendingUp, AlertTriangle, CheckCircle2, RefreshCw, Download } from 'lucide-react'

const SENTIMENT_COLORS = {
  colaborativo: 'text-emerald-600 bg-emerald-50 border-emerald-200',
  ansioso: 'text-amber-600 bg-amber-50 border-amber-200',
  desesperado: 'text-orange-600 bg-orange-50 border-orange-200',
  agressivo: 'text-red-600 bg-red-50 border-red-200',
  neutro: 'text-slate-600 bg-slate-50 border-slate-200',
}

function getObservabilityEntries() {
  try {
    return JSON.parse(sessionStorage.getItem('poc_observability') || '[]')
  } catch {
    return []
  }
}

function HarnessStudio() {
  const [harness, setHarness] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedAgent, setExpandedAgent] = useState(null)

  useEffect(() => {
    fetch('/api/healthz')
      .then((r) => r.json())
      .then(() => {
        // The actual harness YAML is loaded server-side.
        // We show a structured representation from the known spec.
        setHarness({
          version: '1.1',
          provider: 'openrouter',
          agents: [
            {
              id: 'agente_escuta_nlu',
              label: 'Escuta Ativa (NLU)',
              model: 'openai/gpt-4o-mini',
              temperature: 0.1,
              tools: [],
              outputs: ['detected_intent', 'sentiment', 'confidence', 'summary'],
              description: 'Classifica intenção e sentimento. Recebe apenas mensagem + histórico (progressive disclosure).',
            },
            {
              id: 'agente_motor_acordo',
              label: 'Motor de Acordo',
              model: 'openai/gpt-4o',
              temperature: 0.0,
              tools: ['get_debt_status', 'get_politicas_desconto', 'calculate_amortization'],
              outputs: ['calculated_proposal', 'motor_tactic_note'],
              description: 'Consulta MCPs e calcula proposta matemática. Resposta 100% determinística (temp=0).',
            },
            {
              id: 'agente_empatia_copywriter',
              label: 'Empatia (Copywriter)',
              model: 'openai/gpt-4o-mini',
              temperature: 0.7,
              tools: [],
              outputs: ['draft_response'],
              description: 'Traduz proposta matemática em texto humano. Adapta tom e formato ao user_role. Recebe feedback do Guardião em self-correction.',
            },
            {
              id: 'agente_guardiao_compliance',
              label: 'Guardião (Compliance)',
              model: 'openai/gpt-4o',
              temperature: 0.0,
              tools: ['check_guardrail_violations', 'get_cdc_guidelines'],
              outputs: ['compliance_status', 'compliance_feedback', 'compliance_risk'],
              description: 'Dupla validação: regex rápida (Art. 42/71 CDC) + LLM-as-judge semântico. Pode disparar self-correction.',
              guardrails: ['sujar nome', 'processo', 'penhora', 'polícia', 'delegacia', 'prisão'],
            },
          ],
          selfCorrection: {
            trigger: 'compliance_status === REJEITADO',
            retryFrom: 'agente_empatia_copywriter',
            maxAttempts: 2,
          },
        })
      })
      .catch(() => {
        setHarness(null)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="p-4 flex items-center gap-2 text-slate-500 text-sm">
        <RefreshCw size={14} className="animate-spin" />
        Carregando harness...
      </div>
    )
  }

  if (!harness) {
    return (
      <div className="p-4 text-sm text-amber-700">
        <AlertTriangle size={14} className="inline mr-1" />
        Backend não disponível. Inicie o servidor.
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Harness Studio</h3>
          <p className="text-xs text-slate-500">v{harness.version} · provider: {harness.provider}</p>
        </div>
        <span className="text-[10px] font-bold bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded">LIVE</span>
      </div>

      <div className="space-y-2">
        {harness.agents.map((agent) => (
          <div key={agent.id} className="border border-slate-200 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setExpandedAgent(expandedAgent === agent.id ? null : agent.id)}
              className="btn-interactive w-full flex items-start justify-between gap-3 p-3 text-left hover:bg-slate-50"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-800">{agent.label}</span>
                  <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">{agent.model}</span>
                  <span className="text-[10px] text-slate-400">T={agent.temperature}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">{agent.description}</p>
              </div>
              <Code2 size={14} className={`shrink-0 mt-0.5 transition-transform ${expandedAgent === agent.id ? 'rotate-90' : ''} text-slate-400`} />
            </button>

            {expandedAgent === agent.id && (
              <div className="border-t border-slate-100 p-3 bg-slate-50 space-y-3">
                {agent.tools.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Tools / MCPs</p>
                    <div className="flex flex-wrap gap-1">
                      {agent.tools.map((t) => (
                        <span key={t} className="text-[10px] font-mono bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Outputs do State Graph</p>
                  <div className="flex flex-wrap gap-1">
                    {agent.outputs.map((o) => (
                      <span key={o} className="text-[10px] font-mono bg-brand-50 text-brand-700 border border-brand-200 px-2 py-0.5 rounded">{o}</span>
                    ))}
                  </div>
                </div>
                {agent.guardrails && (
                  <div>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Guardrails (Regex Block)</p>
                    <div className="flex flex-wrap gap-1">
                      {agent.guardrails.map((g) => (
                        <span key={g} className="text-[10px] font-mono bg-red-50 text-red-700 border border-red-200 px-2 py-0.5 rounded">&quot;{g}&quot;</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
        <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider mb-1">Self-Correction Loop</p>
        <p className="text-xs text-amber-800">
          Trigger: <code className="font-mono bg-amber-100 px-1 rounded">{harness.selfCorrection.trigger}</code>
        </p>
        <p className="text-xs text-amber-800 mt-1">
          Retry de: <strong>{harness.selfCorrection.retryFrom}</strong> · max {harness.selfCorrection.maxAttempts}x
        </p>
      </div>
    </div>
  )
}

function SentimentBar({ entries }) {
  const sentimentCounts = entries.reduce((acc, e) => {
    if (e.sentiment) acc[e.sentiment] = (acc[e.sentiment] || 0) + 1
    return acc
  }, {})

  const total = entries.length || 1

  return (
    <div className="space-y-2">
      {Object.entries(sentimentCounts).map(([sentiment, count]) => (
        <div key={sentiment}>
          <div className="flex justify-between text-[10px] font-semibold mb-0.5">
            <span className="capitalize text-slate-600">{sentiment}</span>
            <span className="text-slate-500">{count}/{entries.length}</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${SENTIMENT_COLORS[sentiment]?.split(' ')[2] || 'bg-slate-300'}`}
              style={{ width: `${(count / total) * 100}%`, backgroundColor: undefined }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function ObservabilityPanel({ agentState }) {
  const [entries, setEntries] = useState([])

  useEffect(() => {
    const load = () => setEntries(getObservabilityEntries())
    load()
    const interval = setInterval(load, 2000)
    return () => clearInterval(interval)
  }, [agentState.lastObservability])

  const totalTokens = entries.reduce((s, e) => s + (e.total_tokens || 0), 0)
  const totalCost = entries.reduce((s, e) => s + (e.estimated_cost_usd || 0), 0)
  const avgLatency = entries.length ? Math.round(entries.reduce((s, e) => s + (e.total_latency_ms || 0), 0) / entries.length) : 0
  const corrections = entries.reduce((s, e) => s + (e.self_corrections || 0), 0)

  function handleExportObs() {
    const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `observability_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800">Observabilidade</h3>
        {entries.length > 0 && (
          <button
            type="button"
            onClick={handleExportObs}
            className="btn-interactive flex items-center gap-1 text-[10px] text-slate-500 border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50"
          >
            <Download size={10} /> Exportar
          </button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: 'Execuções', value: entries.length, icon: Cpu, color: 'text-brand-600' },
          { label: 'Tokens totais', value: totalTokens.toLocaleString(), icon: BarChart2, color: 'text-emerald-600' },
          { label: 'Custo est.', value: `$${totalCost.toFixed(4)}`, icon: TrendingUp, color: 'text-amber-600' },
          { label: 'Latência méd.', value: avgLatency ? `${avgLatency}ms` : '—', icon: Clock, color: 'text-slate-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-slate-50 border border-slate-200 rounded-xl p-2.5">
            <div className={`flex items-center gap-1 mb-1 ${color}`}>
              <Icon size={11} />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
            </div>
            <div className="text-sm font-bold text-slate-800">{value}</div>
          </div>
        ))}
      </div>

      {corrections > 0 && (
        <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-amber-800">
          <RefreshCw size={12} />
          <span><strong>{corrections}</strong> self-correction(s) realizadas nesta sessão</span>
        </div>
      )}

      {/* Sentiment distribution */}
      {entries.length > 0 && (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Distribuição de Sentimento</p>
          <SentimentBar entries={entries} />
        </div>
      )}

      {/* Execution log */}
      {entries.length === 0 ? (
        <div className="text-center py-6 text-sm text-slate-400">
          <BarChart2 size={24} className="mx-auto mb-2 opacity-40" />
          Nenhuma execução ainda. Envie uma mensagem.
        </div>
      ) : (
        <div>
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Histórico de Execuções</p>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {entries.map((e, i) => (
              <div key={i} className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-[11px]">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-slate-700 block truncate">{e.intent || '—'}</span>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={`inline-flex items-center gap-0.5 ${e.compliance_status === 'APROVADO' ? 'text-emerald-600' : 'text-red-500'}`}>
                        {e.compliance_status === 'APROVADO' ? <CheckCircle2 size={9} /> : <AlertTriangle size={9} />}
                        {e.compliance_status}
                      </span>
                      {e.sentiment && (
                        <span className={`border rounded px-1 py-0.5 text-[9px] font-semibold ${SENTIMENT_COLORS[e.sentiment] || SENTIMENT_COLORS.neutro}`}>
                          {e.sentiment}
                        </span>
                      )}
                      {e.self_corrections > 0 && (
                        <span className="text-amber-600 flex items-center gap-0.5">
                          <RefreshCw size={9} /> {e.self_corrections}x
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-slate-500">{e.total_tokens}t</div>
                    <div className="text-slate-400">{e.total_latency_ms}ms</div>
                    {e.mode === 'simulation' && <div className="text-[9px] text-amber-500">sim</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function EngineerCockpit({ agentState }) {
  const [activeTab, setActiveTab] = useState('observability')

  const tabs = [
    { id: 'observability', label: 'Observability', icon: BarChart2 },
    { id: 'harness', label: 'Harness Studio', icon: Code2 },
  ]

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-slate-200 bg-slate-50 shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`btn-interactive flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-bold uppercase tracking-wider border-b-2 transition-colors ${
                isActive ? 'border-brand-500 text-brand-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={12} aria-hidden="true" />
              {tab.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'observability' && <ObservabilityPanel agentState={agentState} />}
        {activeTab === 'harness' && <HarnessStudio />}
      </div>

      <div className="border-t border-slate-100 px-4 py-2 bg-slate-50">
        <p className="text-[9px] text-slate-400 text-center">
          Inspirado no <a href="https://monest.com.br/collections" target="_blank" rel="noopener noreferrer" className="underline hover:text-slate-600">Collections Engineer</a> da Monest
        </p>
      </div>
    </div>
  )
}
