import { useMemo, useState } from "react"
import { formatColor, parseColor } from "../../utils/color"
import type { RGBA } from "../../types"

type EyeDropperResult = {
  sRGBHex: string
}

type EyeDropperConstructor = new () => {
  open: () => Promise<EyeDropperResult>
}

declare global {
  interface Window {
    EyeDropper?: EyeDropperConstructor
  }
}

const INITIAL_COLOR = "#61d394"

function colorValues(color: string) {
  const parsed = parseColor(color)
  if (!parsed) return []

  return [
    ["HEX", formatColor(parsed, "hex")],
    ["RGB", formatColor(parsed, "rgb")],
    ["HSL", formatColor(parsed, "hsl")],
    ["OKLCH", formatColor(parsed, "oklch")]
  ] as const
}

function relativeLuminance({ r, g, b }: RGBA) {
  const channel = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

export function EyedropperSection() {
  const [color, setColor] = useState(INITIAL_COLOR)
  const [status, setStatus] = useState<string | null>(null)
  const values = useMemo(() => colorValues(color), [color])
  const parsed = parseColor(color)
  const fg = parsed && relativeLuminance(parsed) > 0.54 ? "#111111" : "#ffffff"

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setStatus("Copied")
    window.setTimeout(() => setStatus(null), 1200)
  }

  const pick = async () => {
    const EyeDropper = window.EyeDropper
    if (!EyeDropper) {
      setStatus("Unavailable")
      return
    }

    try {
      const result = await new EyeDropper().open()
      setColor(result.sRGBHex)
      await copy(result.sRGBHex)
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setStatus(err instanceof Error ? err.message : "Pick failed")
    }
  }

  return (
    <div className="h-full flex flex-col overflow-y-auto overflow-x-hidden p-4 gap-4">
      <div
        className="h-40 rounded-lg border border-border shadow-lg flex items-end p-4"
        style={{ background: color, color: fg }}
      >
        <div className="font-mono text-2xl font-semibold">{values[0]?.[1] ?? color}</div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={pick}
          className="flex-1 px-3 py-2 rounded bg-primary/20 text-primary hover:bg-primary/30 text-xs font-medium"
        >
          Pick Color
        </button>
        {status && <span className="text-[11px] text-fg/50 min-w-16">{status}</span>}
      </div>

      <div className="grid gap-2">
        {values.map(([label, value]) => (
          <button
            key={label}
            onClick={() => copy(value)}
            className="flex items-center gap-3 px-3 py-2 rounded border border-border bg-card hover:border-accent text-left"
            title={`Copy ${value}`}
          >
            <span className="w-12 text-[10px] text-fg/35 font-medium">{label}</span>
            <span className="font-mono text-xs text-fg/80 truncate">{value}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
