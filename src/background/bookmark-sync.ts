import { getSettings } from "../storage"
import {
  BOOKMARK_SNAPSHOT_KEY,
  pullBookmarkSnapshot,
  readBookmarkSnapshot,
  type StoredBookmark
} from "../lib/bookmark-snapshot"
import { createSidebarApiClient, type BookmarkPayload } from "../lib/sidebar-api"
import { getBookmarkTombstones, setLastSyncedBookmarkIds } from "../lib/bookmark-tombstones"

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
  const refreshCachedSnapshot = () => {
    void pullBookmarkSnapshot().catch((err) => {
      console.warn("[bookmark-sync] failed to refresh local bookmark cache:", (err as Error).message)
    })
  }

  api?.onCreated?.addListener(refreshCachedSnapshot)
  api?.onRemoved?.addListener(refreshCachedSnapshot)
  api?.onChanged?.addListener(refreshCachedSnapshot)
  api?.onMoved?.addListener(refreshCachedSnapshot)

  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local") return
    if (BOOKMARK_SNAPSHOT_KEY in changes) scheduleSync()
  })

  // Push once on extension startup so the server has a current snapshot
  // even if no bookmarks change. The extension-owned cache is the source of
  // truth; browser bookmark APIs only hydrate that cache when it is absent.
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

    const snapshot = (await readBookmarkSnapshot()) ?? (await pullBookmarkSnapshot())
    // Exclude bookmarks the server already deleted (tombstoned) so we never
    // re-push them. Server is the source of truth.
    const tombstones = await getBookmarkTombstones()
    const pushable = snapshot.bookmarks.filter((b) => !tombstones.has(b.id))
    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)
    await client.bookmarks.snapshot(pushable.map(toPayload), snapshot.pulledAt)
    // Record the ids we actually pushed so the reconciler can detect future
    // server-side deletions (lastSynced minus server).
    await setLastSyncedBookmarkIds(pushable.map((b) => b.id))
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
