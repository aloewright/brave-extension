import { getSettings } from "../storage"
import { createSidebarApiClient, type RecordingUploadMetadata } from "../lib/sidebar-api"

/**
 * Uploads a finished recording to the sidebar-api Worker. Call this from
 * the recorder pipeline once the local save completes (the recorder
 * already keeps the bytes in memory before writing to Downloads).
 *
 * No-op when sidebar sync is off or the URL/token aren't configured —
 * recording still lands on disk; the user can flip the toggle later
 * and reingest from the saved file.
 */
export async function uploadRecording(
  blob: Blob,
  metadata: RecordingUploadMetadata
): Promise<{ uploaded: boolean; id?: string; status?: string; reason?: string }> {
  const settings = await getSettings()
  if (!settings.sidebarSyncEnabled) {
    return { uploaded: false, reason: "sidebar sync disabled" }
  }
  if (!settings.sidebarApiUrl || !settings.sidebarApiToken) {
    return { uploaded: false, reason: "sidebar api not configured" }
  }

  try {
    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)
    const res = await client.recordings.upload(blob, metadata)
    return { uploaded: true, id: res.id, status: res.status }
  } catch (err) {
    return { uploaded: false, reason: (err as Error).message }
  }
}
