import { getSettings } from "../storage"
import { pullBookmarkSnapshot, type StoredBookmark } from "../lib/bookmark-snapshot"
import { createSidebarApiClient, type BookmarkPayload } from "../lib/sidebar-api"

const DEBOUNCE_MS = 5000
const LAST_PUSH_KEY = "ai-dev-sidebar-bookmark-last-push"

let timer: ReturnType<typeof setTimeout> | null = null
let inflight = false

function toPayload(b: StoredBookmark): BookmarkPayload {
  return {
    id: b.id,
    url: b.url,
    title: b.title,
    parentId: b.parentId ?? null,
    path: b.path,
    category: b.category,
    isFavorite: b.isFavorite,
    dateAdded: b.dateAdded ?? null,
    index: b.index ?? null
  }
}

export function setupBookmarkSync(): void {
  // chrome.bookmarks may be undefined in tests / restricted contexts.
  const api = (chrome as unknown as { bookmarks?: typeof chrome.bookmarks }).bookmarks
  if (!api) return

  api.onCreated.addListener(scheduleSync)
  api.onRemoved.addListener(scheduleSync)
  api.onChanged.addListener(scheduleSync)
  api.onMoved.addListener(scheduleSync)

  // Push once on extension startup so the server has a current snapshot
  // even if no bookmarks change.
  scheduleSync()
}

function scheduleSync(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    void pushSnapshot()
  }, DEBOUNCE_MS)
}

export async function pushSnapshot(): Promise<{ pushed: boolean; reason?: string }> {
  if (inflight) return { pushed: false, reason: "already running" }
  inflight = true
  try {
    const settings = await getSettings()
    if (!settings.sidebarSyncEnabled) return { pushed: false, reason: "sidebar sync disabled" }
    if (!settings.sidebarApiUrl || !settings.sidebarApiToken) {
      return { pushed: false, reason: "sidebar api not configured" }
    }

    const snapshot = await pullBookmarkSnapshot()
    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)
    await client.bookmarks.snapshot(snapshot.bookmarks.map(toPayload), snapshot.pulledAt)
    await chrome.storage.local.set({ [LAST_PUSH_KEY]: Date.now() })
    return { pushed: true }
  } catch (err) {
    console.warn("[bookmark-sync] push failed:", (err as Error).message)
    return { pushed: false, reason: (err as Error).message }
  } finally {
    inflight = false
  }
}

// Visible for tests.
export const __internal = { DEBOUNCE_MS, LAST_PUSH_KEY }
