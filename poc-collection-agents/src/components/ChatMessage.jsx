import { User, Bot, Clock, Check, Copy, CheckCheck, FileText, Target, AlertTriangle, ShieldAlert, Zap } from 'lucide-react'
import { formatTime } from '../utils.js'

/**
 * Single chat bubble renderer.
 *
 * Variants (mutually exclusive when AGENT mode):
 *   - SecurityBlock — red badge "Bloqueado pelo Sistema de Segurança"
 *   - ComplianceAlert — text contains "ALERTA"
 *   - ProposalRejected — text contains "PROPOSTA RECUSADA"
 *   - TacticSuggested — text contains "TÁTICA"
 *
 * Action buttons (AGENT only): Aplicar / Copiar / Exportar Trace
 * Action button (CUSTOMER only, when proposal approved & is latest AI msg): PIX CTA
 */
export function ChatMessage({
  msg,
  mode,
  modeCfg,
  isLatestAI,
  agentState,
  actionFeedback,
  onApplyProposal,
  onCopyMessage,
  onExportTrace,
  onPixCta,
}) {
  if (msg.role === 'system') {
    return (
      <div className="w-full text-center py-2 text-xs font-semibold text-slate-500 uppercase tracking-widest">
        {msg.text}
      </div>
    )
  }

  const isUser = msg.role === 'user'
  const isAI = msg.role === 'ai'
  const showPixCta = isAI
    && mode === 'CUSTOMER'
    && agentState.complianceStatus === 'APROVADO'
    && agentState.calculatedProposal
    && isLatestAI
  const showAgentActions = isAI && mode === 'AGENT'

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      <div className={`flex gap-3 max-w-[88%] ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
            isUser ? 'bg-slate-200 text-slate-600' : modeCfg.avatarBg
          }`}
          aria-hidden="true"
        >
          {isUser ? <User size={15} /> : <Bot size={15} />}
        </div>

        <div
          className={`px-4 py-3 rounded-2xl shadow-sm text-sm whitespace-pre-wrap leading-relaxed ${
            isUser ? 'bg-slate-800 text-white rounded-tr-sm' : `${modeCfg.msgBg} rounded-tl-sm`
          }`}
        >
          {msg.isSecurityBlock && (
            <div className="flex items-center gap-1.5 text-red-700 font-bold text-xs uppercase mb-2 pb-2 border-b border-red-200">
              <ShieldAlert size={13} aria-hidden="true" />
              Bloqueado pelo Sistema de Segurança
            </div>
          )}
          {isAI && mode === 'AGENT' && msg.text.includes('ALERTA') && (
            <div className="flex items-center gap-1.5 text-red-600 font-bold text-xs uppercase mb-2 pb-2 border-b border-red-100">
              <AlertTriangle size={13} aria-hidden="true" />
              Alerta de Compliance
            </div>
          )}
          {isAI && mode === 'AGENT' && msg.text.includes('TÁTICA') && !msg.text.includes('ALERTA') && (
            <div className="flex items-center gap-1.5 text-brand-700 font-bold text-xs uppercase mb-2 pb-2 border-b border-brand-100">
              <Target size={13} aria-hidden="true" />
              Tática Sugerida
            </div>
          )}
          {isAI && mode === 'AGENT' && msg.text.includes('PROPOSTA RECUSADA') && (
            <div className="flex items-center gap-1.5 text-amber-700 font-bold text-xs uppercase mb-2 pb-2 border-b border-amber-100">
              <AlertTriangle size={13} aria-hidden="true" />
              Proposta Recusada
            </div>
          )}
          {msg.text}

          {showPixCta && (
            <div className="mt-3 pt-3 border-t border-emerald-100">
              <button
                type="button"
                onClick={() => onPixCta(msg.id)}
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

          {showAgentActions && (
            <div className="mt-3 pt-3 border-t border-slate-200/70 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onApplyProposal(msg.id)}
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
                onClick={() => onCopyMessage(msg.id, msg.text)}
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
                onClick={onExportTrace}
                className="btn-interactive text-xs bg-white text-slate-500 min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 flex items-center gap-1.5"
              >
                <FileText size={13} aria-hidden="true" /> Exportar Trace
              </button>
            </div>
          )}
        </div>
      </div>

      <div className={`flex items-center gap-1 text-[10px] text-slate-400 px-11 ${isUser ? 'flex-row-reverse' : ''}`}>
        <Clock size={9} aria-hidden="true" />
        {formatTime(msg.ts)}
      </div>
    </div>
  )
}
