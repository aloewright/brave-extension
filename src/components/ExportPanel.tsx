import { useState } from "react"

import type { ElementSnapshot } from "../types"
import { generateCss, generateHtml, generateTailwind } from "../utils/codegen"

interface Props {
  snapshot: ElementSnapshot
  onCopy: (text: string) => void
}

const TABS = ["html", "css", "tailwind"] as const
type Tab = (typeof TABS)[number]

export function ExportPanel({ snapshot, onCopy }: Props) {
  const [tab, setTab] = useState<Tab>("html")

  const code =
    tab === "html"
      ? generateHtml(snapshot)
      : tab === "css"
        ? generateCss(snapshot)
        : generateTailwind(snapshot)

  return (
    <div className="rounded bg-card border border-border overflow-hidden">
      <div className="flex border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 text-[10px] uppercase tracking-wider py-1.5 transition-colors ${
              tab === t ? "bg-accent text-fg" : "text-fg/40 hover:text-fg/70"
            }`}>
            {t}
          </button>
        ))}
        <button
          onClick={() => onCopy(code)}
          title="Copy"
          className="px-3 text-[10px] uppercase tracking-wider text-chart-1 hover:bg-chart-1/10 transition-colors">
          Copy
        </button>
      </div>
      <pre className="p-2 text-[10px] font-mono text-fg/80 max-h-48 overflow-auto whitespace-pre-wrap break-all">
        {code}
      </pre>
    </div>
  )
}
