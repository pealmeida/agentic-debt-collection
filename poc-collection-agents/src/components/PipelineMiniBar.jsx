import { Check, PanelRight } from 'lucide-react'
import { PIPELINE_STEPS } from '../constants.js'
import { getStepStatus } from '../utils.js'

export function PipelineMiniBar({ agentState, onOpenSidebar }) {
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
