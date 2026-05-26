import { useState } from 'react'
import { X, FileText, ArrowRightLeft, AlertTriangle, User, Calculator, Bot, ShieldAlert, CheckCircle2, LayoutGrid, BrainCircuit, Zap } from 'lucide-react'
import { LOG_COLORS, MODES } from '../constants.js'
import { InspectorPanel } from './InspectorPanel.jsx'
import { EngineerCockpit } from './EngineerCockpit.jsx'

function AgentStepItem({ icon, title, active, completed, detail, isSuccess }) {
  let bgColor = 'bg-white border-slate-200 text-slate-400'
  if (active) bgColor = 'bg-brand-50 border-brand-300 text-brand-600 ring-4 ring-brand-50'
  if (completed) bgColor = isSuccess ? 'bg-emerald-50 border-emerald-300 text-emerald-600' : 'bg-slate-100 border-slate-300 text-slate-700'

  return (
    <div className="relative flex items-start gap-3 z-10">
      <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${bgColor}`}>
        {completed && !active ? <CheckCircle2 size={16} /> : icon}
      </div>
      <div className={`pt-1.5 pb-3 w-full ${active ? 'opacity-100' : completed ? 'opacity-80' : 'opacity-40'}`}>
        <h4 className={`text-xs font-bold ${active ? 'text-brand-700' : 'text-slate-700'}`}>{title}</h4>
        {detail && (
          <p className="text-xs font-medium text-slate-600 mt-1 bg-white border border-slate-100 rounded px-1.5 py-0.5 inline-block break-words whitespace-normal max-w-full leading-tight">
            {detail}
          </p>
        )}
      </div>
    </div>
  )
}

function GrafoTab({ agentState, isProcessing }) {
  const contextRows = [
    { label: 'Devedor', value: agentState.debtInfo?.debtor_name || 'João da Silva', valueClass: 'text-slate-800' },
    { label: 'Dívida Total', value: `R$ ${(agentState.debtInfo?.total_amount || 1200).toFixed(2)}`, valueClass: 'text-red-600' },
    { label: 'Atraso', value: `${agentState.debtInfo?.days_overdue || 45} dias`, valueClass: 'text-amber-700' },
  ]

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-6 overscroll-contain touch-pan-y bg-white">
      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <FileText size={12} aria-hidden="true" /> Contexto Atual (CRM)
        </h3>
        <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs space-y-2.5">
          {contextRows.map(({ label, value, valueClass }) => (
            <div key={label} className="flex justify-between gap-2">
              <span className="text-slate-500">{label}:</span>
              <span className={`font-semibold ${valueClass}`}>{value}</span>
            </div>
          ))}
          {agentState.sentiment && (
            <div className="flex justify-between gap-2 pt-2 border-t border-slate-200">
              <span className="text-slate-500">Sentimento:</span>
              <span className="font-semibold text-brand-700 capitalize">{agentState.sentiment}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t border-slate-200 gap-2">
            <span className="text-slate-500">Lim. Desconto:</span>
            <span className="font-semibold text-emerald-600">30%</span>
          </div>
        </div>

        {agentState.isFallback && (
          <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
            <AlertTriangle size={12} aria-hidden="true" />
            Modo simulação (sem chave OpenRouter)
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <ArrowRightLeft size={12} aria-hidden="true" /> Pipeline de Agentes
        </h3>
        <div className="space-y-2 relative before:absolute before:inset-0 before:ml-[15px] before:-translate-x-px before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-slate-200 before:to-transparent">
          <AgentStepItem
            icon={<User size={14} />}
            title="1. Escuta Ativa (NLU)"
            active={agentState.activeAgent === 'escuta'}
            completed={!!agentState.detectedIntent}
            detail={agentState.detectedIntent}
          />
          <AgentStepItem
            icon={<Calculator size={14} />}
            title="2. Motor de Acordo"
            active={agentState.activeAgent === 'motor'}
            completed={!!agentState.calculatedProposal || agentState.activeAgent === 'empatia' || agentState.activeAgent === 'guardiao' || !!agentState.complianceStatus}
            detail={agentState.calculatedProposal ? `Proposta: R$ ${agentState.calculatedProposal.total} (${agentState.calculatedProposal.desconto} off)` : null}
          />
          <AgentStepItem
            icon={<Bot size={14} />}
            title="3. Empatia (Persona)"
            active={agentState.activeAgent === 'empatia'}
            completed={agentState.activeAgent === 'guardiao' || !!agentState.complianceStatus}
            detail={MODES[agentState.personaMode || 'CUSTOMER']?.shortLabel}
          />
          <AgentStepItem
            icon={<ShieldAlert size={14} />}
            title="4. Guardião (Compliance)"
            active={agentState.activeAgent === 'guardiao'}
            completed={!!agentState.complianceStatus}
            detail={agentState.complianceStatus}
            isSuccess={agentState.complianceStatus === 'APROVADO'}
          />
        </div>
      </div>

      <div className="space-y-2 pt-4 border-t border-slate-200">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Terminal / Logs Internos</h3>
        <div
          className="bg-slate-900 rounded-xl p-3 h-44 overflow-y-auto font-mono text-xs text-emerald-400 leading-relaxed shadow-inner"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
        >
          {agentState.ragLogs.length === 0 ? (
            <span className="text-slate-500">Aguardando eventos do orquestrador...</span>
          ) : (
            agentState.ragLogs.map((log, i) => (
              <div key={i} className={`mb-1 ${LOG_COLORS[log.type] || LOG_COLORS.info}`}>
                {`> ${log.text}`}
              </div>
            ))
          )}
          {isProcessing && <div className="motion-reduce:animate-none animate-pulse mt-1 text-slate-500">_</div>}
        </div>
      </div>
    </div>
  )
}

export function SidebarPanel({ mode, agentState, isProcessing, onClose }) {
  const [activeTab, setActiveTab] = useState('grafo')

  const tabs = mode === 'AGENT'
    ? [
        { id: 'grafo', label: 'Grafo', icon: LayoutGrid },
        { id: 'inspector', label: 'Inspetor IA', icon: BrainCircuit },
        { id: 'cockpit', label: 'Cockpit', icon: Zap },
      ]
    : [
        { id: 'grafo', label: 'Grafo', icon: LayoutGrid },
        { id: 'inspector', label: 'Inspetor IA', icon: BrainCircuit },
      ]

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="flex items-center border-b border-slate-200 bg-white shrink-0">
        <div className="flex flex-1" role="tablist" aria-label="Painéis do agente">
          {tabs.map((tab) => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`btn-interactive flex-1 flex items-center justify-center gap-2 min-h-[48px] text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                  isActive ? 'border-brand-500 text-brand-700 bg-brand-50/50' : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon size={14} aria-hidden="true" />
                {tab.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          className="btn-interactive md:hidden min-h-[48px] min-w-[48px] flex items-center justify-center text-slate-500 hover:text-slate-700 border-l border-slate-200"
          onClick={onClose}
          aria-label="Fechar painel"
        >
          <X size={18} />
        </button>
      </div>

      {activeTab === 'grafo' && <GrafoTab agentState={agentState} isProcessing={isProcessing} />}
      {activeTab === 'inspector' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <InspectorPanel inspector={agentState.inspector} isProcessing={isProcessing} />
        </div>
      )}
      {activeTab === 'cockpit' && (
        <div className="flex-1 min-h-0 overflow-hidden">
          <EngineerCockpit agentState={agentState} />
        </div>
      )}
    </div>
  )
}
