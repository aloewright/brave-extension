/**
 * Bookmark tombstone + last-synced tracking for server-authoritative sync.
 *
 * Tombstones record bookmark ids that were deleted on the server (e.g. in
 * the hub) so the extension never re-pushes them. Last-synced records the
 * ids included in the most recent successful snapshot push, so the next
 * reconcile pass can detect server-side deletions (lastSynced minus server).
 *
 * Both are chrome.storage.local-backed; guarded so non-extension contexts
 * (tests) degrade to empty / no-op rather than throwing.
 */
export const BOOKMARK_TOMBSTONES_KEY = "bookmarks.tombstones.v1" as const
export const BOOKMARK_LAST_SYNCED_KEY = "bookmarks.lastSynced.v1" as const

function isStorage(): boolean {
  return typeof chrome !== "undefined" && !!chrome?.storage?.local
}

export async function getBookmarkTombstones(): Promise<Set<string>> {
  if (!isStorage()) return new Set()
  const got = await chrome.storage.local.get(BOOKMARK_TOMBSTONES_KEY)
  const raw = got[BOOKMARK_TOMBSTONES_KEY]
  if (!Array.isArray(raw)) return new Set()
  return new Set(raw.filter((id): id is string => typeof id === "string"))
}

export async function addBookmarkTombstones(ids: string[]): Promise<void> {
  if (!isStorage() || ids.length === 0) return
  const existing = await getBookmarkTombstones()
  for (const id of ids) existing.add(id)
  await chrome.storage.local.set({ [BOOKMARK_TOMBSTONES_KEY]: Array.from(existing) })
}

export async function getLastSyncedBookmarkIds(): Promise<string[]> {
  if (!isStorage()) return []
  const got = await chrome.storage.local.get(BOOKMARK_LAST_SYNCED_KEY)
  const raw = got[BOOKMARK_LAST_SYNCED_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((id): id is string => typeof id === "string")
}

export async function setLastSyncedBookmarkIds(ids: string[]): Promise<void> {
  if (!isStorage()) return
  await chrome.storage.local.set({ [BOOKMARK_LAST_SYNCED_KEY]: ids })
}
