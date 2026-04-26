import { evaluateContrastFromStrings } from "../utils/contrast"

interface Props {
  fg: string
  bg: string
  target: "AA" | "AAA"
}

export function ContrastBadge({ fg, bg, target }: Props) {
  const result = evaluateContrastFromStrings(fg, bg)
  if (!result) return null

  const passNormal = target === "AA" ? result.AAnormal : result.AAAnormal
  const passLarge = target === "AA" ? result.AAlarge : result.AAAlarge

  const ratio = result.ratio.toFixed(2)
  const tone = passNormal ? "chart-2" : passLarge ? "chart-3" : "destructive"

  return (
    <div className={`px-2 py-1.5 rounded border bg-${tone}/10 border-${tone}/30 text-[10px] font-mono flex items-center gap-2`}>
      <span className={`text-${tone}`}>{ratio}:1</span>
      <span className="text-fg/40">·</span>
      <span className={passNormal ? `text-${tone}` : "text-fg/40"}>{target} normal {passNormal ? "✓" : "✗"}</span>
      <span className="text-fg/40">·</span>
      <span className={passLarge ? `text-${tone}` : "text-fg/40"}>{target} large {passLarge ? "✓" : "✗"}</span>
    </div>
  )
}
