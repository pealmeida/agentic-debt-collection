import { useState } from 'react'
import { BrainCircuit, Wrench, Database, FileText } from 'lucide-react'

const TABS = [
  { id: 'thinking', label: 'Thought', icon: BrainCircuit, color: 'text-brand-400' },
  { id: 'tools', label: 'Tools', icon: Wrench, color: 'text-emerald-400' },
  { id: 'ragContext', label: 'RAG', icon: Database, color: 'text-amber-400' },
]

export function InspectorPanel({ inspector, isProcessing }) {
  const [activeTab, setActiveTab] = useState('thinking')

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-slate-900 text-slate-300">
      <div className="flex border-b border-slate-700 shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          const count = inspector[tab.id]?.length || 0
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`btn-interactive flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                isActive ? `border-brand-500 ${tab.color} bg-slate-800` : 'border-transparent text-slate-500 hover:text-slate-400'
              }`}
            >
              <Icon size={13} aria-hidden="true" />
              {tab.label}
              {count > 0 && (
                <span className={`text-[9px] font-bold rounded-full px-1.5 py-0.5 ${isActive ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-4 font-mono text-xs space-y-2">
        {activeTab === 'thinking' && (
          inspector.thinking.length === 0 ? (
            <span className="text-slate-500 italic">Aguardando processamento...</span>
          ) : (
            inspector.thinking.map((t, i) => (
              <div key={i} className="bg-slate-800/70 p-2.5 rounded border border-slate-700">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-brand-300 font-bold">[{t.step}] {t.agentShort || t.agent || 'agent'}</span>
                  <span className="text-slate-500">
                    {(t.tokens || 0).toLocaleString()}t · {t.latency_ms || 0}ms
                    {t.cost_usd ? ` · $${Number(t.cost_usd).toFixed(6)}` : ''}
                  </span>
                </div>
                {t.model && <div className="text-slate-500 mb-1 break-all">model: {t.model}</div>}
                <div className="text-slate-300 whitespace-pre-wrap">{t.text}</div>
              </div>
            ))
          )
        )}

        {activeTab === 'tools' && (
          inspector.tools.length === 0 ? (
            <span className="text-slate-500 italic">Nenhuma ferramenta invocada.</span>
          ) : (
            inspector.tools.map((tool, i) => (
              <div key={i} className="bg-slate-800 p-2.5 rounded border border-slate-700">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-emerald-300 font-bold">{tool.name}</div>
                  <span className="text-slate-500">[{tool.step}] {tool.agentShort || tool.agent}</span>
                </div>
                <div className="text-slate-400 mt-1 break-all">Args: {tool.payload}</div>
                <div className={`mt-1 font-bold ${tool.status === 200 || tool.status === '200' ? 'text-emerald-500' : 'text-red-400'}`}>
                  Status: {tool.status}
                </div>
              </div>
            ))
          )
        )}

        {activeTab === 'ragContext' && (
          inspector.ragContext.length === 0 ? (
            <span className="text-slate-500 italic">Nenhum documento recuperado.</span>
          ) : (
            inspector.ragContext.map((rag, i) => (
              <div key={i} className="bg-slate-800 p-2.5 rounded border border-slate-700">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-amber-300 font-bold flex items-center gap-1.5">
                    <FileText size={12} aria-hidden="true" />
                    {rag.source}
                  </div>
                  <span className="text-slate-500 shrink-0">[{rag.step}] {rag.agentShort || rag.agent}</span>
                </div>
                <div className="text-slate-400 mt-1 italic line-clamp-4">&quot;{rag.snippet}&quot;</div>
              </div>
            ))
          )
        )}

        {isProcessing && <div className="motion-reduce:animate-none animate-pulse text-slate-500">_</div>}
      </div>
    </div>
  )
}
