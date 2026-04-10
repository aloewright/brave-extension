import type { CLIBackend } from "../types"
import { BACKEND_INFO } from "../types"

export function BackendSwitcher({
  active,
  onChange,
  onReset
}: {
  active: CLIBackend
  onChange: (backend: CLIBackend) => void
  onReset: (backend: CLIBackend) => void
}) {
  const backends = Object.entries(BACKEND_INFO) as [CLIBackend, typeof BACKEND_INFO[CLIBackend]][]

  return (
    <div className="flex gap-0.5 bg-card/30 rounded p-0.5 items-center">
      {backends.map(([key, info]) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          title={info.description}
          className={`px-2 py-1 rounded text-[10px] font-medium transition-all ${
            active === key
              ? "text-fg shadow-sm"
              : "text-fg/30 hover:text-fg/50"
          }`}
          style={{
            backgroundColor: active === key ? info.color + "25" : "transparent",
            color: active === key ? info.color : undefined
          }}
        >
          {info.name.split(" ")[0]}
        </button>
      ))}

      {/* Reset button for active backend */}
      <button
        onClick={() => onReset(active)}
        title={`Reset ${BACKEND_INFO[active].name} session`}
        className="ml-auto p-1 rounded hover:bg-accent text-fg/30 hover:text-fg/60 transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
        </svg>
      </button>
    </div>
  )
}
