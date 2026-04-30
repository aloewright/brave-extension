import { useState } from "react"

import type { ScanResult, TokenFormat } from "../types"
import { generateTokens, inputsFromScan } from "../utils/tokens"

interface Props {
  scan: ScanResult
  defaultFormat: TokenFormat
  includeSpacing: boolean
  includeFonts: boolean
  onCopy: (text: string) => void
}

const FORMATS: TokenFormat[] = ["tailwind", "css", "json"]

export function TokensPanel({ scan, defaultFormat, includeSpacing, includeFonts, onCopy }: Props) {
  const [format, setFormat] = useState<TokenFormat>(defaultFormat)

  const payload = generateTokens(inputsFromScan(scan, includeSpacing, includeFonts), format)

  return (
    <div className="rounded bg-card border border-border overflow-hidden">
      <div className="flex border-b border-border">
        {FORMATS.map((f) => (
          <button
            key={f}
            onClick={() => setFormat(f)}
            className={`flex-1 text-[10px] uppercase tracking-wider py-1.5 transition-colors ${
              format === f ? "bg-accent text-fg" : "text-fg/40 hover:text-fg/70"
            }`}>
            {f}
          </button>
        ))}
        <button
          onClick={() => onCopy(payload)}
          title="Copy"
          className="px-3 text-[10px] uppercase tracking-wider text-chart-1 hover:bg-chart-1/10 transition-colors">
          Copy
        </button>
      </div>
      <pre className="p-2 text-[10px] font-mono text-fg/80 max-h-48 overflow-auto whitespace-pre-wrap break-all">
        {payload}
      </pre>
    </div>
  )
}
