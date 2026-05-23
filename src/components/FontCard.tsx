import { primaryFamily } from "../utils/fonts"

interface Props {
  family: string
  size?: string
  weight?: string
  lineHeight?: string
  letterSpacing?: string
  count?: number
  onCopy?: (text: string) => void
}

export function FontCard({ family, size, weight, lineHeight, letterSpacing, count, onCopy }: Props) {
  const primary = primaryFamily(family)
  const stack = `${family}${size ? ` · ${size}` : ""}${weight ? ` · ${weight}` : ""}`
  return (
    <button
      onClick={() => onCopy?.(family)}
      title="Copy font-family"
      className="block w-full text-left p-3 rounded bg-card border border-border hover:border-accent transition-colors">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-semibold truncate" style={{ fontFamily: family }}>
          {primary || "—"}
        </div>
        {count !== undefined && <span className="text-[10px] text-fg/30">×{count}</span>}
      </div>
      <div className="text-[10px] text-fg/40 truncate font-mono mt-0.5">{stack}</div>
      {(lineHeight || letterSpacing) && (
        <div className="text-[10px] text-fg/30 mt-1 flex gap-3">
          {lineHeight && <span>lh: {lineHeight}</span>}
          {letterSpacing && <span>tracking: {letterSpacing}</span>}
        </div>
      )}
    </button>
  )
}
