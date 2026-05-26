import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Bot,
  User,
  CheckCircle2,
  ShieldAlert,
  Cpu,
  Calculator,
  FileText,
  Send,
  ArrowRightLeft,
  Menu,
  X,
  Check,
  Sparkles,
  BrainCircuit,
  Database,
  Wrench,
  Copy,
  CheckCheck,
  PanelRight,
  AlertTriangle,
  Target,
  LayoutGrid,
  Clock,
  Settings,
  Zap,
} from 'lucide-react'
import { runPipeline, formatSecurityThreat } from './services/orchestrator.js'
import { SettingsModal } from './components/SettingsModal.jsx'
import { EngineerCockpit } from './components/EngineerCockpit.jsx'

// ─── Session ID (multi-turn) ──────────────────────────────────────────────────

function getOrCreateSessionId() {
  try {
    let id = sessionStorage.getItem('poc_session_id')
    if (!id) {
      id = `sess_${Math.random().toString(36).slice(2, 11)}`
      sessionStorage.setItem('poc_session_id', id)
    }
    return id
  } catch {
    return `sess_${Math.random().toString(36).slice(2, 11)}`
  }
}

function saveObservabilityEntry(entry) {
  try {
    const raw = sessionStorage.getItem('poc_observability') || '[]'
    const entries = JSON.parse(raw)
    entries.unshift({ ...entry, ts: Date.now() })
    sessionStorage.setItem('poc_observability', JSON.stringify(entries.slice(0, 50)))
  } catch { /* ignore */ }
}

// ─── Constants ───────────────────────────────────────────────────────────────

const LOG_COLORS = {
  info: 'text-emerald-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
  success: 'text-emerald-500',
}

const PIPELINE_STEPS = [
  { id: 'agente_escuta_nlu', label: 'NLU', fullLabel: 'Escuta Ativa (NLU)' },
  { id: 'agente_motor_acordo', label: 'Motor', fullLabel: 'Motor de Acordo' },
  { id: 'agente_empatia_copywriter', label: 'Empatia', fullLabel: 'Empatia (Persona)' },
  { id: 'agente_guardiao_compliance', label: 'Guardião', fullLabel: 'Guardião (Compliance)' },
]

const AGENT_ID_MAP = {
  agente_escuta_nlu: 'escuta',
  agente_motor_acordo: 'motor',
  agente_empatia_copywriter: 'empatia',
  agente_guardiao_compliance: 'guardiao',
}

const MODES = {
  CUSTOMER: {
    label: 'Visão Cliente',
    shortLabel: 'Cliente',
    icon: User,
    accentBg: 'bg-emerald-600',
    accentText: 'text-emerald-700',
    accentBorder: 'border-emerald-500',
    accentLight: 'bg-emerald-50',
    accentLightBorder: 'border-emerald-100',
    badge: 'Assistente IA',
    badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    msgBg: 'bg-white border border-emerald-100',
    avatarBg: 'bg-emerald-100 text-emerald-700',
  },
  AGENT: {
    label: 'Collections Engineer',
    shortLabel: 'Engineer',
    icon: ShieldAlert,
    accentBg: 'bg-brand-600',
    accentText: 'text-brand-700',
    accentBorder: 'border-brand-500',
    accentLight: 'bg-brand-50',
    accentLightBorder: 'border-brand-100',
    badge: 'Cockpit CRM',
    badgeBg: 'bg-brand-50 text-brand-700 border-brand-200',
    msgBg: 'bg-brand-50 border border-brand-100 text-brand-900',
    avatarBg: 'bg-brand-100 text-brand-700',
  },
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts))
}

function getStepStatus(stepId, agentState) {
  const { activeAgent, detectedIntent, calculatedProposal, complianceStatus } = agentState
  const shortId = AGENT_ID_MAP[stepId] || stepId
  switch (shortId) {
    case 'escuta':
      return { active: activeAgent === 'escuta', completed: !!detectedIntent, success: !!detectedIntent }
    case 'motor':
      return {
        active: activeAgent === 'motor',
        completed: !!calculatedProposal || activeAgent === 'empatia' || activeAgent === 'guardiao' || !!complianceStatus,
        success: !!calculatedProposal || !!complianceStatus,
      }
    case 'empatia':
      return {
        active: activeAgent === 'empatia',
        completed: activeAgent === 'guardiao' || !!complianceStatus,
        success: true,
      }
    case 'guardiao':
      return {
        active: activeAgent === 'guardiao',
        completed: !!complianceStatus,
        success: complianceStatus === 'APROVADO',
      }
    default:
      return { active: false, completed: false, success: false }
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModeSwitchBar({ mode, onChangeMode, isProcessing }) {
  return (
    <div className="flex shrink-0 border-b border-slate-200 bg-white" role="tablist" aria-label="Selecionar visão">
      {Object.entries(MODES).map(([key, cfg]) => {
        const Icon = cfg.icon
        const isActive = mode === key
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => !isProcessing && onChangeMode(key)}
            disabled={isProcessing}
            className={`btn-interactive flex-1 flex items-center justify-center gap-2 min-h-[48px] text-sm font-semibold transition-all duration-200 border-b-2 disabled:opacity-60 ${
              isActive
                ? `${cfg.accentBorder} ${cfg.accentText} bg-slate-50`
                : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="hidden xs:inline sm:inline">{cfg.shortLabel}</span>
            <span className="hidden md:inline">{cfg.label}</span>
            {isActive && (
              <span className={`hidden sm:inline text-[10px] font-bold px-1.5 py-0.5 rounded border ${cfg.badgeBg}`}>
                {cfg.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function PipelineMiniBar({ agentState, onOpenSidebar }) {
  return (
    <div className="md:hidden border-b border-slate-200 bg-slate-50 px-3 py-2 shrink-0" aria-label="Progresso do pipeline" role="group">
      <div className="flex items-center gap-1">
        {PIPELINE_STEPS.map((step, index) => {
          const { active, completed, success } = getStepStatus(step.id, agentState)
          let dotClass = 'bg-slate-200 border-slate-300 text-slate-400'
          if (active) dotClass = 'bg-brand-100 border-brand-400 text-brand-700 ring-2 ring-brand-100'
          else if (completed) dotClass = success ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-200 border-slate-400 text-slate-600'

          return (
            <div key={step.id} className="flex items-center flex-1 min-w-0">
              <div
                className={`flex flex-col items-center flex-1 min-w-0 transition-opacity ${active ? 'opacity-100' : completed ? 'opacity-90' : 'opacity-40'}`}
                title={step.fullLabel}
                aria-label={`${step.fullLabel}: ${active ? 'em execução' : completed ? 'concluído' : 'pendente'}`}
              >
                <div className={`w-7 h-7 rounded-full border-2 flex items-center justify-center text-[9px] font-bold shrink-0 transition-colors ${dotClass}`}>
                  {completed && !active ? <Check size={12} /> : index + 1}
                </div>
                <span className="text-[9px] font-semibold text-slate-500 mt-0.5 truncate w-full text-center">{step.label}</span>
              </div>
              {index < PIPELINE_STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-0.5 mb-3 rounded transition-colors ${completed ? 'bg-emerald-300' : 'bg-slate-200'}`} aria-hidden="true" />
              )}
            </div>
          )
        })}
        <button
          type="button"
          onClick={onOpenSidebar}
          className="btn-interactive shrink-0 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-brand-700 ml-1"
          aria-label="Abrir painel do grafo"
        >
          <PanelRight size={18} />
        </button>
      </div>
    </div>
  )
}

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

function InspectorPanel({ inspector, isProcessing }) {
  const [activeTab, setActiveTab] = useState('thinking')

  const tabs = [
    { id: 'thinking', label: 'Thought', icon: BrainCircuit, color: 'text-brand-400', count: inspector.thinking.length },
    { id: 'tools', label: 'Tools', icon: Wrench, color: 'text-emerald-400', count: inspector.tools.length },
    { id: 'ragContext', label: 'RAG', icon: Database, color: 'text-amber-400', count: inspector.ragContext.length },
  ]

  return (
    <div className="flex flex-col h-full bg-slate-900 text-slate-300">
      <div className="flex border-b border-slate-700 shrink-0">
        {tabs.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
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
              {tab.count > 0 && (
                <span className={`text-[9px] font-bold rounded-full px-1.5 py-0.5 ${isActive ? 'bg-slate-700 text-slate-300' : 'bg-slate-800 text-slate-500'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="flex-1 overflow-y-auto p-4 font-mono text-xs space-y-2">
        {activeTab === 'thinking' && (
          <>
            {inspector.thinking.length === 0 ? (
              <span className="text-slate-500 italic">Aguardando processamento...</span>
            ) : (
              inspector.thinking.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <span className="text-slate-500 shrink-0">[{t.step}]</span>
                  <span className="text-slate-300">{t.text}</span>
                </div>
              ))
            )}
          </>
        )}

        {activeTab === 'tools' && (
          <>
            {inspector.tools.length === 0 ? (
              <span className="text-slate-500 italic">Nenhuma ferramenta invocada.</span>
            ) : (
              inspector.tools.map((tool, i) => (
                <div key={i} className="bg-slate-800 p-2.5 rounded border border-slate-700">
                  <div className="text-emerald-300 font-bold">{tool.name}</div>
                  <div className="text-slate-400 mt-1 break-all">Args: {tool.payload}</div>
                  <div className={`mt-1 font-bold ${tool.status === 200 || tool.status === '200' ? 'text-emerald-500' : 'text-red-400'}`}>
                    Status: {tool.status}
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {activeTab === 'ragContext' && (
          <>
            {inspector.ragContext.length === 0 ? (
              <span className="text-slate-500 italic">Nenhum documento recuperado.</span>
            ) : (
              inspector.ragContext.map((rag, i) => (
                <div key={i} className="bg-slate-800 p-2.5 rounded border border-slate-700">
                  <div className="text-amber-300 font-bold flex items-center gap-1.5">
                    <FileText size={12} aria-hidden="true" />
                    {rag.source}
                  </div>
                  <div className="text-slate-400 mt-1 italic line-clamp-4">&quot;{rag.snippet}&quot;</div>
                </div>
              ))
            )}
          </>
        )}

        {isProcessing && <div className="motion-reduce:animate-none animate-pulse text-slate-500">_</div>}
      </div>
    </div>
  )
}

function SidebarPanel({ mode, agentState, isProcessing, onClose }) {
  const [activeTab, setActiveTab] = useState('grafo')

  const isAgent = mode === 'AGENT'

  const tabs = isAgent
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
    <div className="flex flex-col h-full">
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

      {activeTab === 'grafo' && (
        <div className="flex-1 overflow-y-auto p-5 space-y-6 overscroll-contain bg-white">
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <FileText size={12} aria-hidden="true" /> Contexto Atual (CRM)
            </h3>
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs space-y-2.5">
              {[
                { label: 'Devedor', value: agentState.debtInfo?.debtor_name || 'João da Silva', valueClass: 'text-slate-800' },
                { label: 'Dívida Total', value: `R$ ${(agentState.debtInfo?.total_amount || 1200).toFixed(2)}`, valueClass: 'text-red-600' },
                { label: 'Atraso', value: `${agentState.debtInfo?.days_overdue || 45} dias`, valueClass: 'text-amber-700' },
              ].map(({ label, value, valueClass }) => (
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
      )}

      {activeTab === 'inspector' && (
        <div className="flex-1 min-h-0">
          <InspectorPanel inspector={agentState.inspector} isProcessing={isProcessing} />
        </div>
      )}

      {activeTab === 'cockpit' && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <EngineerCockpit agentState={agentState} />
        </div>
      )}
    </div>
  )
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [mode, setMode] = useState('CUSTOMER')
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [actionFeedback, setActionFeedback] = useState(null)
  const sessionId = useRef(getOrCreateSessionId())

  const [agentState, setAgentState] = useState({
    activeAgent: null,
    debtInfo: null,
    detectedIntent: null,
    sentiment: null,
    calculatedProposal: null,
    complianceStatus: null,
    personaMode: 'CUSTOMER',
    ragLogs: [],
    inspector: { thinking: [], tools: [], ragContext: [] },
    isFallback: false,
    lastObservability: null,
  })

  const chatEndRef = useRef(null)

  const scrollToBottom = useCallback(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chatEndRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, agentState.activeAgent, scrollToBottom])

  useEffect(() => {
    if (!actionFeedback) return
    const timer = setTimeout(() => setActionFeedback(null), 2500)
    return () => clearTimeout(timer)
  }, [actionFeedback])

  useEffect(() => {
    if (mode === 'CUSTOMER') {
      setMessages([
        {
          id: 1,
          role: 'ai',
          ts: Date.now(),
          text: 'Olá João! Aqui é a assistente da Financeira. Verifiquei que temos uma parcela de R$ 1.200,00 em atraso há 45 dias. Como posso te ajudar hoje a regularizar essa situação?',
        },
      ])
    } else {
      setMessages([
        {
          id: 1,
          role: 'system',
          ts: Date.now(),
          text: 'COCKPIT COLLECTIONS ENGINEER — Caso ativo: João da Silva (D-9982). Aguardando input da chamada ou chat.',
        },
      ])
    }

    setAgentState((prev) => ({
      ...prev,
      activeAgent: null,
      detectedIntent: null,
      sentiment: null,
      calculatedProposal: null,
      complianceStatus: null,
      personaMode: mode,
      ragLogs: [],
      inspector: { thinking: [], tools: [], ragContext: [] },
      isFallback: false,
      lastObservability: null,
    }))
  }, [mode])

  const suggestions = {
    CUSTOMER: [
      { label: 'Perdi emprego', text: 'Fiquei desempregado e não tenho R$ 1.200. Aceitam R$ 500 para quitar tudo?' },
      { label: 'Mais parcelas', text: 'As parcelas estão pesadas. Não conseguem fazer em 5 ou 6 vezes?' },
      { label: 'Ameaça Procon', text: 'Essa dívida é um absurdo! Vou acionar o Procon e processar vocês!' },
    ],
    AGENT: [
      { label: 'Cliente quer 70% off', text: 'Cliente ofereceu R$ 350 para quitar a dívida de R$ 1200 à vista.' },
      { label: 'Cliente Agressivo', text: 'Cliente está gritando, xingando e ameaçando chamar advogado.' },
      { label: 'Promessa Futura', text: 'Cliente diz que só recebe dia 10 do mês que vem e pede para segurar.' },
    ],
  }

  function handleCopyMessage(msgId, text) {
    navigator.clipboard.writeText(text)
    setActionFeedback({ msgId, type: 'copied' })
  }

  function handleApplyProposal(msgId) {
    setActionFeedback({ msgId, type: 'applied' })
  }

  function handleExportTrace() {
    const data = {
      session_id: sessionId.current,
      mode,
      agent_state: agentState,
      messages: messages.filter((m) => m.role !== 'system'),
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `trace_${sessionId.current}_${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const addLog = useCallback((type, text) =>
    setAgentState((prev) => ({ ...prev, ragLogs: [...prev.ragLogs, { type, text }] })), [])

  const updateInspector = useCallback((key, data) =>
    setAgentState((prev) => ({
      ...prev,
      inspector: { ...prev.inspector, [key]: [...prev.inspector[key], data] },
    })), [])

  async function handleSendMessage(customText) {
    const textToSend = customText || inputText
    if (!textToSend.trim() || isProcessing) return

    const userMessage = { id: Date.now(), role: 'user', ts: Date.now(), text: textToSend }
    setMessages((prev) => [...prev, userMessage])
    setInputText('')
    setIsProcessing(true)

    // Reset inspector for new turn
    setAgentState((prev) => ({
      ...prev,
      activeAgent: null,
      detectedIntent: null,
      sentiment: null,
      calculatedProposal: null,
      complianceStatus: null,
      ragLogs: [],
      inspector: { thinking: [], tools: [], ragContext: [] },
      isFallback: false,
    }))

    // Build history for multi-turn
    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }))

    let stepIndex = 0

    try {
      for await (const event of runPipeline(textToSend, {
        sessionId: sessionId.current,
        userRole: mode,
        history,
      })) {
        switch (event.type) {
          case 'fallback':
            setAgentState((prev) => ({ ...prev, isFallback: true }))
            addLog('warn', `[Sistema] Modo simulação: ${event.data.reason === 'no_api_key' ? 'sem chave OpenRouter' : 'sem conexão'}`)
            break

          case 'agent_start': {
            const shortId = AGENT_ID_MAP[event.data.id] || event.data.id
            setAgentState((prev) => ({ ...prev, activeAgent: shortId }))
            addLog('info', `[${event.data.id}] Iniciando${event.data.model !== 'mock' ? ` (${event.data.model})` : ''}...`)
            break
          }

          case 'state_update':
            setAgentState((prev) => ({
              ...prev,
              detectedIntent: event.data.detected_intent || prev.detectedIntent,
              sentiment: event.data.sentiment || prev.sentiment,
            }))
            break

          case 'agent_end': {
            const { id, patch, trace } = event.data
            const shortId = AGENT_ID_MAP[id] || id
            stepIndex++

            if (patch?.detected_intent) {
              setAgentState((prev) => ({ ...prev, detectedIntent: patch.detected_intent, sentiment: patch.sentiment }))
            }
            if (patch?.calculated_proposal !== undefined) {
              setAgentState((prev) => ({ ...prev, calculatedProposal: patch.calculated_proposal }))
            }
            if (patch?.compliance_status) {
              setAgentState((prev) => ({ ...prev, complianceStatus: patch.compliance_status }))
            }
            if (patch?.debt_info) {
              setAgentState((prev) => ({ ...prev, debtInfo: patch.debt_info }))
            }

            if (trace) {
              if (trace.thought) {
                updateInspector('thinking', { step: stepIndex, text: trace.thought })
                addLog('info', `[${shortId}] ${trace.thought.slice(0, 80)}${trace.thought.length > 80 ? '...' : ''}`)
              }
              if (trace.tools?.length) {
                trace.tools.forEach((t) => updateInspector('tools', t))
              }
              if (trace.rag?.length) {
                trace.rag.forEach((r) => updateInspector('ragContext', r))
              }
            }
            break
          }

          case 'self_correction':
            addLog('warn', `[Guardião] Self-correction #${event.data.attempt}: "${event.data.feedback?.slice(0, 60)}..."`)
            updateInspector('thinking', { step: stepIndex + 0.5, text: `Self-correction activada: ${event.data.feedback}` })
            break

          case 'final': {
            const { response, compliance_status, calculated_proposal, detected_intent, sentiment, observability, self_corrections } = event.data

            setAgentState((prev) => ({
              ...prev,
              activeAgent: null,
              complianceStatus: compliance_status,
              calculatedProposal: calculated_proposal || prev.calculatedProposal,
              detectedIntent: detected_intent || prev.detectedIntent,
              sentiment: sentiment || prev.sentiment,
              lastObservability: observability,
            }))

            addLog('success', `[Guardião] Output liberado (${compliance_status}). Tokens: ${observability?.total_tokens || 0}, Latência: ${observability?.total_latency_ms || 0}ms`)

            if (self_corrections > 0) {
              addLog('warn', `[Pipeline] ${self_corrections} self-correction(s) realizada(s).`)
            }

            saveObservabilityEntry({
              intent: detected_intent,
              compliance_status,
              sentiment,
              total_tokens: observability?.total_tokens || 0,
              total_latency_ms: observability?.total_latency_ms || 0,
              estimated_cost_usd: observability?.estimated_cost_usd || 0,
              self_corrections: self_corrections || 0,
              mode: observability?.mode || 'real',
            })

            setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'ai', ts: Date.now() + 1, text: response }])
            break
          }

          case 'security_block': {
            const threatLabels = (event.data.threats || []).map((t) => formatSecurityThreat(t.threat)).join(', ')
            addLog('error', `[Segurança] Mensagem bloqueada: ${threatLabels}`)
            setMessages((prev) => [
              ...prev,
              {
                id: Date.now() + 1,
                role: 'ai',
                ts: Date.now() + 1,
                text: event.data.user_message || 'Sua mensagem foi bloqueada pelo sistema de segurança.',
                isSecurityBlock: true,
              },
            ])
            break
          }

          case 'error':
            addLog('error', `[Pipeline] Erro: ${event.data.message}`)
            setMessages((prev) => [
              ...prev,
              { id: Date.now() + 1, role: 'ai', ts: Date.now() + 1, text: 'Ocorreu um erro ao processar sua mensagem. Por favor, tente novamente.' },
            ])
            break
        }
      }
    } finally {
      setIsProcessing(false)
      setAgentState((prev) => ({ ...prev, activeAgent: null }))
    }
  }

  const modeCfg = MODES[mode]

  return (
    <div className="min-h-dvh w-full bg-slate-100 font-sans flex justify-center safe-area-top safe-area-bottom">
      <a
        href="#main-chat"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[60] focus:px-4 focus:py-2 focus:bg-brand-600 focus:text-white focus:rounded-lg focus:font-medium"
      >
        Pular para o chat
      </a>

      <div className="flex min-h-dvh w-full max-w-7xl relative overflow-hidden">
        {showSidebar && (
          <div className="fixed inset-0 bg-slate-900/50 z-40 md:hidden" onClick={() => setShowSidebar(false)} aria-hidden="true" />
        )}

        {/* ── Chat column ── */}
        <div className="flex-1 flex flex-col min-h-dvh relative bg-white shadow-2xl md:rounded-r-none lg:rounded-none min-w-0 border-r border-slate-200">

          {/* Header */}
          <header className="bg-white px-4 py-3 border-b border-slate-200 flex items-center justify-between z-20 shrink-0">
            <div className="flex items-center gap-3 min-w-0">
              <button
                type="button"
                className="btn-interactive md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-500"
                onClick={() => setShowSidebar(true)}
                aria-label="Abrir painel do grafo"
              >
                <Menu size={20} />
              </button>
              <div className="flex items-center gap-2.5 min-w-0">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${modeCfg.accentBg}`}>
                  <Bot size={18} className="text-white" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h1 className="font-bold text-sm tracking-tight text-slate-900 truncate">POC Multiagente Cobrança</h1>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${modeCfg.badgeBg}`}>
                    {modeCfg.badge}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-2 text-xs text-slate-500">
                <span className="font-medium">Visão ativa:</span>
                <span className={`font-bold px-2 py-1 rounded-lg border ${modeCfg.badgeBg}`}>{modeCfg.label}</span>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(true)}
                className="btn-interactive min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600"
                aria-label="Configurações"
              >
                <Settings size={18} />
              </button>
            </div>
          </header>

          <ModeSwitchBar mode={mode} onChangeMode={setMode} isProcessing={isProcessing} />
          <PipelineMiniBar agentState={agentState} onOpenSidebar={() => setShowSidebar(true)} />

          {/* Chat messages */}
          <div
            id="main-chat"
            aria-live="polite"
            aria-relevant="additions"
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5 bg-slate-50/60 overscroll-contain touch-manipulation"
          >
            {messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                {msg.role === 'system' && (
                  <div className="w-full text-center py-2 text-xs font-semibold text-slate-500 uppercase tracking-widest">
                    {msg.text}
                  </div>
                )}

                {msg.role !== 'system' && (
                  <>
                    <div className={`flex gap-3 max-w-[88%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                          msg.role === 'user' ? 'bg-slate-200 text-slate-600' : modeCfg.avatarBg
                        }`}
                        aria-hidden="true"
                      >
                        {msg.role === 'user' ? <User size={15} /> : <Bot size={15} />}
                      </div>

                      <div
                        className={`px-4 py-3 rounded-2xl shadow-sm text-sm whitespace-pre-wrap leading-relaxed ${
                          msg.role === 'user' ? 'bg-slate-800 text-white rounded-tr-sm' : `${modeCfg.msgBg} rounded-tl-sm`
                        }`}
                      >
                        {msg.isSecurityBlock && (
                          <div className="flex items-center gap-1.5 text-red-700 font-bold text-xs uppercase mb-2 pb-2 border-b border-red-200">
                            <ShieldAlert size={13} aria-hidden="true" />
                            Bloqueado pelo Sistema de Segurança
                          </div>
                        )}
                        {msg.role === 'ai' && mode === 'AGENT' && msg.text.includes('ALERTA') && (
                          <div className="flex items-center gap-1.5 text-red-600 font-bold text-xs uppercase mb-2 pb-2 border-b border-red-100">
                            <AlertTriangle size={13} aria-hidden="true" />
                            Alerta de Compliance
                          </div>
                        )}
                        {msg.role === 'ai' && mode === 'AGENT' && msg.text.includes('TÁTICA') && !msg.text.includes('ALERTA') && (
                          <div className="flex items-center gap-1.5 text-brand-700 font-bold text-xs uppercase mb-2 pb-2 border-b border-brand-100">
                            <Target size={13} aria-hidden="true" />
                            Tática Sugerida
                          </div>
                        )}
                        {msg.role === 'ai' && mode === 'AGENT' && msg.text.includes('PROPOSTA RECUSADA') && (
                          <div className="flex items-center gap-1.5 text-amber-700 font-bold text-xs uppercase mb-2 pb-2 border-b border-amber-100">
                            <AlertTriangle size={13} aria-hidden="true" />
                            Proposta Recusada
                          </div>
                        )}
                        {msg.text}

                        {/* CUSTOMER: PIX CTA when deal approved */}
                        {msg.role === 'ai' && mode === 'CUSTOMER' && agentState.complianceStatus === 'APROVADO' && agentState.calculatedProposal && msg.id === Math.max(...messages.filter((m) => m.role === 'ai').map((m) => m.id)) && (
                          <div className="mt-3 pt-3 border-t border-emerald-100">
                            <button
                              type="button"
                              onClick={() => setActionFeedback({ msgId: msg.id, type: 'pix' })}
                              className="btn-interactive w-full text-sm bg-emerald-600 text-white min-h-[44px] px-4 py-2.5 rounded-xl font-semibold hover:bg-emerald-700 flex items-center justify-center gap-2"
                            >
                              {actionFeedback?.msgId === msg.id && actionFeedback.type === 'pix' ? (
                                <><CheckCheck size={16} aria-hidden="true" /> Link gerado! Enviando por WhatsApp...</>
                              ) : (
                                <><Zap size={16} aria-hidden="true" /> Quero esse acordo — Pagar R$ {agentState.calculatedProposal.total}</>
                              )}
                            </button>
                          </div>
                        )}

                        {msg.role === 'ai' && mode === 'AGENT' && (
                          <div className="mt-3 pt-3 border-t border-slate-200/70 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleApplyProposal(msg.id)}
                              className="btn-interactive text-xs bg-white text-brand-600 min-h-[40px] px-3 py-2 rounded-lg border border-brand-200 hover:bg-brand-50 flex items-center gap-1.5 font-semibold"
                            >
                              {actionFeedback?.msgId === msg.id && actionFeedback.type === 'applied' ? (
                                <><CheckCheck size={13} aria-hidden="true" /> Aplicada!</>
                              ) : (
                                <><Check size={13} aria-hidden="true" /> Aplicar Proposta</>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(msg.id, msg.text)}
                              className="btn-interactive text-xs bg-white text-slate-600 min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"
                            >
                              {actionFeedback?.msgId === msg.id && actionFeedback.type === 'copied' ? (
                                <><CheckCheck size={13} aria-hidden="true" /> Copiado!</>
                              ) : (
                                <><Copy size={13} aria-hidden="true" /> Copiar</>
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={handleExportTrace}
                              className="btn-interactive text-xs bg-white text-slate-500 min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"
                            >
                              <FileText size={13} aria-hidden="true" /> Exportar Trace
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={`flex items-center gap-1 text-[10px] text-slate-400 px-11 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      <Clock size={9} aria-hidden="true" />
                      {formatTime(msg.ts)}
                    </div>
                  </>
                )}
              </div>
            ))}

            {isProcessing && (
              <div className="flex items-start gap-3" aria-busy="true" aria-label="Processando resposta">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${modeCfg.avatarBg}`}>
                  <Cpu size={15} className="motion-reduce:animate-none animate-pulse" />
                </div>
                <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-slate-500 flex flex-col gap-2.5 min-w-[200px] shadow-sm">
                  <span className="text-xs font-semibold text-slate-500">Orquestrando Multiagentes...</span>
                  <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full w-1/3 bg-brand-500 rounded-full motion-reduce:animate-none animate-[pulse_1s_ease-in-out_infinite]" />
                  </div>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input area */}
          <div className="bg-white p-3 sm:p-4 border-t border-slate-200 shrink-0 flex flex-col gap-3 safe-area-bottom">
            <div className="suggestions-scroll flex overflow-x-auto pb-1 scrollbar-hide gap-2 touch-manipulation">
              {suggestions[mode].map((sug) => (
                <button
                  key={sug.label}
                  type="button"
                  onClick={() => handleSendMessage(sug.text)}
                  disabled={isProcessing}
                  className={`btn-interactive shrink-0 flex items-center gap-1.5 min-h-[40px] px-4 py-2 rounded-full text-sm font-medium border disabled:opacity-50 disabled:cursor-not-allowed ${modeCfg.accentLight} ${modeCfg.accentLightBorder} ${modeCfg.accentText} hover:opacity-80`}
                >
                  <Sparkles size={13} aria-hidden="true" />
                  {sug.label}
                </button>
              ))}
            </div>

            <div className="relative flex items-center">
              <label htmlFor="chat-input" className="sr-only">
                {mode === 'CUSTOMER' ? 'Digite sua mensagem para a assistente IA' : 'Digite a objeção do cliente na ligação'}
              </label>
              <input
                id="chat-input"
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={mode === 'CUSTOMER' ? 'Digite sua mensagem...' : 'Digite a objeção do cliente na ligação...'}
                disabled={isProcessing}
                autoComplete="off"
                className="w-full pl-4 pr-14 min-h-[48px] py-3 rounded-xl border border-slate-300 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all duration-200 text-base disabled:opacity-50 touch-manipulation"
              />
              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={isProcessing || !inputText.trim()}
                aria-label="Enviar mensagem"
                className={`btn-interactive absolute right-1.5 min-h-[40px] min-w-[40px] flex items-center justify-center ${modeCfg.accentBg} text-white rounded-xl disabled:bg-slate-300 disabled:cursor-not-allowed hover:opacity-90`}
              >
                <Send size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        {/* ── Sidebar ── */}
        <div
          className={`fixed inset-y-0 right-0 z-50 w-80 bg-white border-l border-slate-200 transform transition-transform duration-300 ease-in-out motion-reduce:transition-none flex flex-col md:relative md:transform-none md:w-80 lg:w-96 safe-area-top safe-area-bottom ${showSidebar ? 'translate-x-0 shadow-2xl' : 'translate-x-full md:translate-x-0'}`}
        >
          <SidebarPanel
            mode={mode}
            agentState={agentState}
            isProcessing={isProcessing}
            onClose={() => setShowSidebar(false)}
          />
        </div>
      </div>

      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </div>
  )
}
