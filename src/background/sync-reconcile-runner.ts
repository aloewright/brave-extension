import { getSettings } from "../storage"
import { createSidebarApiClient } from "../lib/sidebar-api"
import {
  runSyncReconcile,
  type LocalLink,
  type ServerLink,
  type SyncDeps
} from "../lib/sync-reconcile"
import { flattenBookmarkTree } from "../lib/bookmark-snapshot"
import {
  addBookmarkTombstones,
  getLastSyncedBookmarkIds,
  setLastSyncedBookmarkIds
} from "../lib/bookmark-tombstones"

const LOCAL_LINKS_KEY = "lx_collectedLinks"

let inflight = false

/**
 * Build real deps from the sidebar-api client + chrome.storage + chrome.bookmarks
 * and run one reconcile pass. Gated on sidebarSyncEnabled + configured creds.
 * Fire-and-forget: never throws.
 */
export async function runBackgroundSyncReconcile(): Promise<void> {
  if (inflight) return
  inflight = true
  try {
    const settings = await getSettings()
    if (!settings.sidebarSyncEnabled) return
    if (!settings.sidebarApiUrl || !settings.sidebarApiToken) return

    const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl)

    const deps: SyncDeps = {
      getLocalLinks: async () => {
        const got = await chrome.storage.local.get(LOCAL_LINKS_KEY)
        const raw = got[LOCAL_LINKS_KEY]
        return Array.isArray(raw) ? (raw as LocalLink[]) : []
      },
      setLocalLinks: async (links) => {
        await chrome.storage.local.set({ [LOCAL_LINKS_KEY]: links })
      },
      listServerLinks: async (): Promise<ServerLink[]> => {
        const items = await client.links.list()
        return items.map((i) => ({ id: i.id, url: i.url, title: i.title, tags: i.tags }))
      },
      upsertLink: async (l) => {
        const res = await client.links.upsert({
          id: l.id,
          url: l.url,
          title: l.title,
          tags: l.tags ?? []
        })
        return { id: res.id }
      },
      removeServerLink: async (id) => {
        await client.links.remove(id)
      },
      getBrowserBookmarkIds: async () => {
        const api = (chrome as unknown as { bookmarks?: typeof chrome.bookmarks }).bookmarks
        if (!api?.getTree) return []
        const tree = await api.getTree()
        return flattenBookmarkTree(tree).map((b) => b.id)
      },
      listServerBookmarkIds: async () => {
        const items = await client.bookmarks.list()
        return items.map((i) => i.id)
      },
      getLastSyncedBookmarkIds,
      setLastSyncedBookmarkIds,
      addBookmarkTombstones
    }

    await runSyncReconcile(deps)
  } catch (err) {
    console.warn("[sync-reconcile-runner] failed:", (err as Error).message)
  } finally {
    inflight = false
  }
}

/** Trigger fire-and-forget; safe to call from event listeners. */
export function triggerBackgroundSyncReconcile(): void {
  void runBackgroundSyncReconcile()
}
