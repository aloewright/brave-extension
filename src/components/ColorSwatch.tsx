import { formatColor, parseColor } from "../utils/color"
import type { ColorFormat } from "../types"

interface Props {
  value: string
  format: ColorFormat
  label?: string
  count?: number
  onCopy?: (text: string) => void
}

export function ColorSwatch({ value, format, label, count, onCopy }: Props) {
  const parsed = parseColor(value)
  const display = parsed ? formatColor(parsed, format) : value
  const safe = parsed ? formatColor(parsed, "hex") : value

  return (
    <button
      onClick={() => onCopy?.(display)}
      title={`Copy ${display}`}
      className="group flex items-center gap-2 px-2 py-1.5 rounded bg-card border border-border hover:border-accent transition-colors text-left w-full">
      <div
        className="w-6 h-6 rounded flex-shrink-0 border border-border/40"
        style={{ background: safe }}
      />
      <div className="flex-1 min-w-0">
        {label && <div className="text-[9px] uppercase tracking-wider text-fg/30">{label}</div>}
        <div className="text-[11px] font-mono text-fg/80 truncate">{display}</div>
      </div>
      {count !== undefined && (
        <span className="text-[10px] text-fg/30 flex-shrink-0">×{count}</span>
      )}
    </button>
  )
}
