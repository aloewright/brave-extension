import { getSettings } from "../storage"
import { createSidebarApiClient } from "../lib/sidebar-api"

export interface VideoImportResult {
  ok: boolean
  id?: string
  status?: string
  r2_key?: string
  size_bytes?: number
  reason?: string
}

/**
 * Download an online video via Cobalt (sidebar-api Worker) and store in R2.
 * Requires sidebar sync + API token; Cobalt + Access credentials live on the Worker.
 */
export async function importVideoUrl(pageUrl: string): Promise<VideoImportResult> {
  const settings = await getSettings()
  if (!settings.sidebarSyncEnabled) {
    return { ok: false, reason: "sidebar sync disabled" }
  }
  if (!settings.sidebarApiUrl || !settings.sidebarApiToken) {
    return { ok: false, reason: "sidebar api not configured" }
  }

  try {
    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)
    const res = await client.videos.import({ url: pageUrl })
    return {
      ok: true,
      id: res.id,
      status: res.status,
      r2_key: res.r2_key,
      size_bytes: res.size_bytes,
    }
  } catch (err) {
    return { ok: false, reason: (err as Error).message }
  }
}
