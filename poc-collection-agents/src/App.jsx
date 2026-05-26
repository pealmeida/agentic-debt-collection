import { useState, useEffect, useRef, useCallback } from 'react'
import { Bot, Menu, Send, Sparkles, Settings, Cpu } from 'lucide-react'

import { MODES, SUGGESTIONS, INITIAL_AGENT_STATE } from './constants.js'
import { getOrCreateSessionId, downloadJSON } from './utils.js'
import { runPipeline } from './services/orchestrator.js'
import { applyPipelineEvent } from './services/pipeline-events.js'

import { ModeSwitchBar } from './components/ModeSwitchBar.jsx'
import { PipelineMiniBar } from './components/PipelineMiniBar.jsx'
import { SidebarPanel } from './components/SidebarPanel.jsx'
import { SettingsModal } from './components/SettingsModal.jsx'
import { ChatMessage } from './components/ChatMessage.jsx'

const INITIAL_MESSAGES = {
  CUSTOMER: {
    id: 1,
    role: 'ai',
    text: 'Olá João! Aqui é a assistente da Financeira. Verifiquei que temos uma parcela de R$ 1.200,00 em atraso há 45 dias. Como posso te ajudar hoje a regularizar essa situação?',
  },
  AGENT: {
    id: 1,
    role: 'system',
    text: 'COCKPIT COLLECTIONS ENGINEER — Caso ativo: João da Silva (D-9982). Aguardando input da chamada ou chat.',
  },
}

export default function App() {
  const [mode, setMode] = useState('CUSTOMER')
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [actionFeedback, setActionFeedback] = useState(null)
  const [agentState, setAgentState] = useState(INITIAL_AGENT_STATE)

  const sessionId = useRef(getOrCreateSessionId())
  const chatEndRef = useRef(null)

  // Auto-scroll on new messages or active-agent change
  const scrollToBottom = useCallback(() => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    chatEndRef.current?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, agentState.activeAgent, scrollToBottom])

  // Clear action feedback after 2.5s
  useEffect(() => {
    if (!actionFeedback) return
    const timer = setTimeout(() => setActionFeedback(null), 2500)
    return () => clearTimeout(timer)
  }, [actionFeedback])

  // Reset state when persona changes
  useEffect(() => {
    setMessages([{ ...INITIAL_MESSAGES[mode], ts: Date.now() }])
    setAgentState({ ...INITIAL_AGENT_STATE, personaMode: mode })
  }, [mode])

  // ── Action handlers ────────────────────────────────────────────────────────

  const addLog = useCallback((type, text) =>
    setAgentState((prev) => ({ ...prev, ragLogs: [...prev.ragLogs, { type, text }] })), [])

  const updateInspector = useCallback((key, data) =>
    setAgentState((prev) => ({
      ...prev,
      inspector: { ...prev.inspector, [key]: [...prev.inspector[key], data] },
    })), [])

  function handleCopyMessage(msgId, text) {
    navigator.clipboard.writeText(text)
    setActionFeedback({ msgId, type: 'copied' })
  }

  function handleApplyProposal(msgId) {
    setActionFeedback({ msgId, type: 'applied' })
  }

  function handlePixCta(msgId) {
    setActionFeedback({ msgId, type: 'pix' })
  }

  function handleExportTrace() {
    downloadJSON({
      session_id: sessionId.current,
      mode,
      agent_state: agentState,
      messages: messages.filter((m) => m.role !== 'system'),
    }, `trace_${sessionId.current}_${Date.now()}.json`)
  }

  async function handleSendMessage(customText) {
    const textToSend = customText || inputText
    if (!textToSend.trim() || isProcessing) return

    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', ts: Date.now(), text: textToSend }])
    setInputText('')
    setIsProcessing(true)

    // Reset turn-scoped state
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

    // Build history for multi-turn (last 10 messages, system excluded)
    const history = messages
      .filter((m) => m.role !== 'system')
      .slice(-10)
      .map((m) => ({ role: m.role, text: m.text }))

    const stepIndexRef = { current: 0 }
    const eventCtx = { setAgentState, setMessages, addLog, updateInspector, stepIndexRef }

    try {
      for await (const event of runPipeline(textToSend, { sessionId: sessionId.current, userRole: mode, history })) {
        applyPipelineEvent(event, eventCtx)
      }
    } finally {
      setIsProcessing(false)
      setAgentState((prev) => ({ ...prev, activeAgent: null }))
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const modeCfg = MODES[mode]
  const latestAIMessageId = messages.filter((m) => m.role === 'ai').reduce((max, m) => Math.max(max, m.id), 0)

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
              <ChatMessage
                key={msg.id}
                msg={msg}
                mode={mode}
                modeCfg={modeCfg}
                isLatestAI={msg.id === latestAIMessageId}
                agentState={agentState}
                actionFeedback={actionFeedback}
                onApplyProposal={handleApplyProposal}
                onCopyMessage={handleCopyMessage}
                onExportTrace={handleExportTrace}
                onPixCta={handlePixCta}
              />
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
              {SUGGESTIONS[mode].map((sug) => (
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
