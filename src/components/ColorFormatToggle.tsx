import type { ColorFormat } from "../types"

const FORMATS: ColorFormat[] = ["hex", "rgb", "hsl", "oklch"]

interface Props {
  value: ColorFormat
  onChange: (f: ColorFormat) => void
}

export function ColorFormatToggle({ value, onChange }: Props) {
  return (
    <div className="inline-flex bg-card rounded border border-border overflow-hidden">
      {FORMATS.map((f) => (
        <button
          key={f}
          onClick={() => onChange(f)}
          className={`text-[10px] uppercase tracking-wider px-2 py-1 transition-colors ${
            value === f ? "bg-accent text-fg" : "text-fg/40 hover:text-fg/70"
          }`}>
          {f}
        </button>
      ))}
    </div>
  )
}
