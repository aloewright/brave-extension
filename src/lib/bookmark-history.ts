// Bookmark history helpers — read `chrome.history` once and produce sort
// comparators keyed on a normalized URL. Pure-ish: chrome.history.search is
// dependency-injected so tests don't need to monkey-patch globals.

export function normalizeUrl(input: string): string {
  if (!input) return ""
  try {
    const u = new URL(input)
    const host = u.host.toLowerCase().replace(/^www\./, "")
    const path = u.pathname.replace(/\/+$/, "")
    return path ? `${host}${path}` : host
  } catch {
    return input
  }
}

export function compareByVisit(
  a: { url: string },
  b: { url: string },
  map: Map<string, number>,
  direction: "newest-first" | "oldest-first",
): number {
  const ta = map.get(normalizeUrl(a.url))
  const tb = map.get(normalizeUrl(b.url))
  const aMissing = ta == null
  const bMissing = tb == null
  if (aMissing && bMissing) return 0
  if (aMissing) return 1
  if (bMissing) return -1
  return direction === "newest-first" ? tb - ta : ta - tb
}

type HistorySearch = (query: chrome.history.HistoryQuery) => Promise<chrome.history.HistoryItem[]>

export async function loadLastVisitMap(
  searchFn?: HistorySearch | undefined,
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (!searchFn) return map
  try {
    const items = await searchFn({ text: "", startTime: 0, maxResults: 100_000 })
    for (const item of items) {
      if (!item.url || item.lastVisitTime == null) continue
      const key = normalizeUrl(item.url)
      const prev = map.get(key)
      if (prev == null || item.lastVisitTime > prev) {
        map.set(key, item.lastVisitTime)
      }
    }
  } catch {
    // history permission revoked or API unavailable; caller falls back.
  }
  return map
}
