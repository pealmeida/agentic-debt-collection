import { Bot } from 'lucide-react'

/**
 * In-chat "writing" indicator — three bouncing dots inside a chat bubble.
 *
 * Visual identity mirrors the standard WhatsApp / iMessage typing affordance,
 * so the user immediately understands the assistant is composing a reply. The
 * bubble (avatar + shape + color) is intentionally identical to a real AI
 * `ChatMessage` so it reads as "the assistant is about to send a message".
 *
 * Why no inline pipeline graph or status copy here:
 *   • The dedicated pipeline progress lives in `PipelineMiniBar` (above the
 *     chat) and the `SidebarPanel` Inspector — that's the right home for
 *     engineer-facing per-agent state.
 *   • Putting it inside the chat bubble made the chat feel "operational"
 *     instead of conversational. The (...) dots are the universal chat idiom.
 *
 * Accessibility:
 *   • aria-live="polite" announces the current pipeline stage in plain
 *     Portuguese so screen-reader users know what's happening, without
 *     forcing it onto the visual UI.
 *   • The bouncing animation is automatically frozen by the global
 *     `prefers-reduced-motion` rule in index.css.
 *
 * Safe under GP-01 ("Guardião sempre executa por último"): we never render
 * any in-flight LLM draft here — only abstract pipeline phase.
 */
export function ProgressIndicator({ agentState, modeCfg }) {
  const liveStatus = buildLiveStatus(agentState.activeAgent)

  return (
    <div className="flex flex-col gap-1 items-start" aria-busy="true">
      <div className="flex gap-3 max-w-[88%]">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${modeCfg.avatarBg}`}
          aria-hidden="true"
        >
          <Bot size={15} />
        </div>

        <div
          className={`px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm ${modeCfg.msgBg}`}
          aria-label="Assistente está escrevendo"
        >
          <div className="flex items-center gap-1.5" aria-hidden="true">
            <span
              className="typing-dot w-2 h-2 rounded-full bg-slate-400"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="typing-dot w-2 h-2 rounded-full bg-slate-400"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="typing-dot w-2 h-2 rounded-full bg-slate-400"
              style={{ animationDelay: '300ms' }}
            />
          </div>
          <span className="sr-only" aria-live="polite">
            {liveStatus}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * Plain-Portuguese stage announcement for screen-reader users. Mirrors the
 * stages of `pipeline-events.applyPipelineEvent`. Keep it abstract — no
 * proposal numbers, no draft text — both for GP-01 and to avoid noisy
 * announcements as numbers change.
 */
function buildLiveStatus(activeAgent) {
  switch (activeAgent) {
    case 'escuta':
      return 'Escutando sua mensagem'
    case 'motor':
      return 'Calculando proposta dentro da alçada'
    case 'empatia':
      return 'Redigindo resposta empática'
    case 'guardiao':
      return 'Verificando conformidade'
    default:
      return 'Assistente está escrevendo'
  }
}
