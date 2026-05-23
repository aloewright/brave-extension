export interface ChunkOptions {
  maxChars: number      // soft upper bound
  overlapChars: number  // tail of previous chunk prepended to next
}

export function chunkText(text: string, opts: ChunkOptions): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []
  if (trimmed.length <= opts.maxChars) return [trimmed]

  const chunks: string[] = []
  let i = 0
  while (i < trimmed.length) {
    let end = Math.min(i + opts.maxChars, trimmed.length)
    if (end < trimmed.length) {
      const back = Math.max(i + Math.floor(opts.maxChars / 2), end - 300)
      const slice = trimmed.slice(i, end)
      const para = slice.lastIndexOf("\n\n")
      const sent = slice.lastIndexOf(". ")
      const space = slice.lastIndexOf(" ")
      const candidate = para >= 0 ? para + 2 : sent >= 0 ? sent + 2 : space >= 0 ? space + 1 : -1
      if (candidate > 0 && i + candidate > back) end = i + candidate
    }
    chunks.push(trimmed.slice(i, end))
    if (end >= trimmed.length) break
    i = Math.max(end - opts.overlapChars, i + 1)
  }
  return chunks
}
