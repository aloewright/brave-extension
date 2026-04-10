import type { CLIBackend } from "../types"
import { BACKEND_INFO } from "../types"

/**
 * Animated ellipsis bubble shown while a backend is processing but hasn't
 * started streaming output yet. Replaces the static "..." that was confusing.
 */
export function LoadingDots({ backend }: { backend?: CLIBackend }) {
  const info = backend ? BACKEND_INFO[backend] : null
  const color = info?.color || "currentColor"

  return (
    <div className="animate-slide-up px-3 py-1.5">
      {info && (
        <div className="flex items-center gap-1.5 mb-1">
          <div
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-[10px] text-fg/40">{info.name}</span>
        </div>
      )}
      <div className="rounded-lg px-3 py-2.5 bg-card inline-flex items-center gap-1">
        <span
          className="w-1 h-1 rounded-full animate-loading-dot"
          style={{ backgroundColor: color, animationDelay: "0ms" }}
        />
        <span
          className="w-1 h-1 rounded-full animate-loading-dot"
          style={{ backgroundColor: color, animationDelay: "150ms" }}
        />
        <span
          className="w-1 h-1 rounded-full animate-loading-dot"
          style={{ backgroundColor: color, animationDelay: "300ms" }}
        />
      </div>
    </div>
  )
}
