import { MODES } from '../constants.js'

export function ModeSwitchBar({ mode, onChangeMode, isProcessing }) {
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
