import { layout, prepare } from "@chenglou/pretext"

const MESSAGE_FONT = '14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
const MESSAGE_LINE_HEIGHT = 22
const MAX_CACHE_ENTRIES = 120

type EstimateOptions = {
  markdown?: boolean
  font?: string
  lineHeight?: number
  verticalPadding?: number
}

const preparedCache = new Map<string, ReturnType<typeof prepare>>()

function cacheKey(text: string, markdown: boolean) {
  return `${markdown ? "md" : "plain"}:${text}`
}

function getPreparedText(text: string, markdown: boolean) {
  const key = cacheKey(text, markdown)
  const cached = preparedCache.get(key)
  if (cached) return cached
  const prepared = prepare(text, MESSAGE_FONT, {
    whiteSpace: "pre-wrap",
    wordBreak: "normal"
  })
  preparedCache.set(key, prepared)
  if (preparedCache.size > MAX_CACHE_ENTRIES) {
    const oldest = preparedCache.keys().next().value
    if (oldest) preparedCache.delete(oldest)
  }
  return prepared
}

function markdownExtraHeight(text: string) {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  let extra = 0
  let inCode = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inCode = !inCode
      extra += 8
      continue
    }
    if (inCode) continue
    if (/^#{1,3}\s+/.test(trimmed)) extra += 8
    if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) extra += 3
    if (!trimmed) extra += 4
  }
  return extra
}

export function estimateMessageHeight(
  text: string,
  width: number,
  options: EstimateOptions = {}
): number | null {
  const normalized = text || ""
  if (!normalized.trim() || !Number.isFinite(width) || width <= 24) return null

  try {
    const prepared = getPreparedText(normalized, Boolean(options.markdown))
    const measured = layout(prepared, Math.max(24, width), MESSAGE_LINE_HEIGHT)
    return Math.ceil(
      measured.height +
      (options.verticalPadding ?? 0) +
      (options.markdown ? markdownExtraHeight(normalized) : 0)
    )
  } catch {
    return null
  }
}

export const DEFAULT_PRETEXT_LINE_HEIGHT = MESSAGE_LINE_HEIGHT
