import { createSidebarApiClient } from "../lib/sidebar-api"
import type { Highlight } from "../review"
import { getHighlights } from "../review"
import { getSettings } from "../storage"

interface HighlightLike {
  id?: string
  text: string
  sourceUrl?: string
  sourceTitle?: string
  createdAt?: number
}

export async function syncHighlight(highlight: HighlightLike): Promise<
  | { uploaded: true; id: string; created: boolean }
  | { uploaded: false; reason: string }
> {
  const settings = await getSettings()
  if (!settings.sidebarSyncEnabled) {
    return { uploaded: false, reason: "sidebar sync disabled" }
  }
  if (!settings.sidebarApiUrl || !settings.sidebarApiToken) {
    return { uploaded: false, reason: "sidebar api not configured" }
  }

  try {
    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)
    const res = await client.highlights.upsert({
      id: highlight.id,
      text: highlight.text,
      sourceUrl: highlight.sourceUrl ?? null,
      sourceTitle: highlight.sourceTitle ?? null,
      source: "extension",
      createdAt: highlight.createdAt
    })
    return { uploaded: true, id: res.id, created: res.created }
  } catch (err) {
    return { uploaded: false, reason: (err as Error).message }
  }
}

export async function syncStoredHighlights(): Promise<{ uploaded: number; skipped: number; failed: number }> {
  const highlights: Highlight[] = await getHighlights()
  let uploaded = 0
  let skipped = 0
  let failed = 0

  for (const highlight of highlights) {
    const res = await syncHighlight(highlight)
    if (res.uploaded) {
      uploaded++
      continue
    }
    const reason = (res as { uploaded: false; reason: string }).reason
    if (reason === "sidebar sync disabled" || reason === "sidebar api not configured") skipped++
    else failed++
  }

  return { uploaded, skipped, failed }
}
