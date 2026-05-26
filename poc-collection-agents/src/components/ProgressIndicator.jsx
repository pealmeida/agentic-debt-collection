import { Cpu, Check } from 'lucide-react'
import { PIPELINE_STEPS } from '../constants.js'
import { getStepStatus } from '../utils.js'

/**
 * Live per-agent progress feedback shown in the chat while the pipeline runs.
 *
 * Replaces the static "Orquestrando Multiagentes..." spinner with a contextual
 * status line + 4-dot pipeline visualization that updates on every SSE event
 * from /api/orchestrate (~1s cadence). The user sees the system actually
 * advancing instead of staring at a generic loader for 6+ seconds.
 *
 * Safe under GP-01 ("Guardião sempre executa por último"): we only surface
 * pipeline metadata (intent, sentiment, proposal numbers), never the un-vetted
 * Empatia draft.
 */
export function ProgressIndicator({ agentState, modeCfg }) {
  const { activeAgent, detectedIntent, sentiment, calculatedProposal } = agentState

  const statusText = buildStatusText({ activeAgent, detectedIntent, sentiment, calculatedProposal })

  return (
    <div className="flex items-start gap-3" aria-busy="true" aria-label="Processando resposta">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${modeCfg.avatarBg}`}>
        <Cpu size={15} className="motion-reduce:animate-none animate-pulse" />
      </div>

      <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm text-sm text-slate-600 flex flex-col gap-3 min-w-[260px] max-w-md shadow-sm">
        <span className="text-xs font-semibold text-slate-700 leading-snug" aria-live="polite">
          {statusText}
        </span>

        <div className="flex items-center gap-1" role="group" aria-label="Pipeline de agentes">
          {PIPELINE_STEPS.map((step, index) => {
            const { active, completed, success } = getStepStatus(step.id, agentState)
            let dotClass = 'bg-slate-100 border-slate-300 text-slate-400'
            if (active) dotClass = 'bg-brand-100 border-brand-400 text-brand-700 ring-2 ring-brand-100 motion-reduce:animate-none animate-pulse'
            else if (completed) dotClass = success ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-slate-200 border-slate-400 text-slate-600'

            return (
              <div key={step.id} className="flex items-center flex-1 min-w-0">
                <div
                  className={`flex flex-col items-center flex-1 min-w-0 transition-opacity duration-200 ${active ? 'opacity-100' : completed ? 'opacity-90' : 'opacity-40'}`}
                  title={step.fullLabel}
                  aria-label={`${step.fullLabel}: ${active ? 'em execução' : completed ? 'concluído' : 'pendente'}`}
                >
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[9px] font-bold shrink-0 transition-colors ${dotClass}`}>
                    {completed && !active ? <Check size={11} /> : index + 1}
                  </div>
                  <span className="text-[9px] font-semibold text-slate-500 mt-0.5 truncate w-full text-center">{step.label}</span>
                </div>
                {index < PIPELINE_STEPS.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-0.5 mb-3 rounded transition-colors ${completed ? 'bg-emerald-300' : 'bg-slate-200'}`} aria-hidden="true" />
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/**
 * Build a single-line status update from the current pipeline state.
 * Each line carries forward the last piece of useful info (intent → proposal →
 * compliance) so the message density grows as the pipeline progresses.
 */
function buildStatusText({ activeAgent, detectedIntent, sentiment, calculatedProposal }) {
  if (!activeAgent) return 'Iniciando orquestração...'

  switch (activeAgent) {
    case 'escuta':
      return 'Escutando sua mensagem...'

    case 'motor': {
      const tail = detectedIntent ? ` (${detectedIntent}${sentiment ? `, ${sentiment}` : ''})` : ''
      return `Calculando proposta dentro da alçada${tail}...`
    }

    case 'empatia': {
      if (calculatedProposal) {
        const total = formatCurrency(calculatedProposal.total)
        const installments = calculatedProposal.installments
        return `Proposta: ${total} em ${installments}x. Redigindo resposta empática...`
      }
      return 'Redigindo resposta empática...'
    }

    case 'guardiao':
      return 'Verificando conformidade CDC (Art. 42/71)...'

    default:
      return 'Orquestrando agentes...'
  }
}

function formatCurrency(value) {
  if (!Number.isFinite(value)) return 'R$ ?'
  return `R$ ${value.toFixed(2).replace('.', ',')}`
}
