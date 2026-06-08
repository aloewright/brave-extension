/**
 * Server-authoritative bidirectional sync reconciler.
 *
 * The txt.fly.pm sidebar-api Worker is the source of truth. These pure
 * functions (no chrome.* / fetch) compute what should happen locally given
 * the local and server state; `runSyncReconcile` wires them to chrome
 * storage + the API client via injected deps.
 */

export interface LocalLink {
  id?: string
  url: string
  title: string
  tags?: string[]
}

export interface ServerLink {
  id: string
  url: string
  title: string
  tags?: string[]
}

export interface LinkReconcilePlan {
  /** local items to retain (incl. server-only added + still-valid) */
  keepLocal: LocalLink[]
  /** previously-synced local items deleted on the server */
  removeLocally: LocalLink[]
  /** local-only items (no server id) to upsert */
  pushUp: LocalLink[]
}

/**
 * Server is source of truth. Match by server id.
 * - local has id but id NOT in server set  -> removeLocally (server deleted it)
 * - local has no id                        -> pushUp (and keep)
 * - server item whose id is not in any local item -> add to keepLocal
 */
export function reconcileLinks(local: LocalLink[], server: ServerLink[]): LinkReconcilePlan {
  const serverById = new Map<string, ServerLink>()
  for (const s of server) serverById.set(s.id, s)

  const keepLocal: LocalLink[] = []
  const removeLocally: LocalLink[] = []
  const pushUp: LocalLink[] = []
  const seenServerIds = new Set<string>()

  for (const l of local) {
    if (!l.id) {
      // Local-only: keep and push up.
      pushUp.push(l)
      keepLocal.push(l)
      continue
    }
    if (serverById.has(l.id)) {
      // Matched: keep once.
      keepLocal.push(l)
      seenServerIds.add(l.id)
    } else {
      // Previously synced (has id) but gone from server -> server deleted it.
      removeLocally.push(l)
    }
  }

  // Server-only items: add to keepLocal.
  for (const s of server) {
    if (seenServerIds.has(s.id)) continue
    keepLocal.push({ id: s.id, url: s.url, title: s.title, tags: s.tags })
  }

  return { keepLocal, removeLocally, pushUp }
}

/**
 * Bookmark tombstones: ids we previously synced that are now gone from the
 * server were deleted server-side (e.g. in the hub) -> add to tombstone so
 * we never re-push. Returns lastSynced minus server.
 */
export function bookmarkTombstoneAdditions(lastSyncedIds: string[], serverIds: string[]): string[] {
  const serverSet = new Set(serverIds)
  return lastSyncedIds.filter((id) => !serverSet.has(id))
}

export interface SyncDeps {
  getLocalLinks: () => Promise<LocalLink[]>
  setLocalLinks: (links: LocalLink[]) => Promise<void>
  listServerLinks: () => Promise<ServerLink[]>
  upsertLink: (l: LocalLink) => Promise<{ id: string }>
  /** reserved; not required to call */
  removeServerLink: (id: string) => Promise<void>
  getBrowserBookmarkIds: () => Promise<string[]>
  listServerBookmarkIds: () => Promise<string[]>
  getLastSyncedBookmarkIds: () => Promise<string[]>
  setLastSyncedBookmarkIds: (ids: string[]) => Promise<void>
  addBookmarkTombstones: (ids: string[]) => Promise<void>
}

/**
 * Orchestrate one reconcile pass. Each section is wrapped so a failure in
 * one doesn't abort the other; never throws.
 */
export async function runSyncReconcile(deps: SyncDeps): Promise<void> {
  // 1) Links.
  try {
    const [local, server] = await Promise.all([deps.getLocalLinks(), deps.listServerLinks()])
    const plan = reconcileLinks(local, server)

    // Push up local-only items and fill in their server ids.
    const pushedIds = new Map<LocalLink, string>()
    for (const item of plan.pushUp) {
      try {
        const { id } = await deps.upsertLink(item)
        pushedIds.set(item, id)
      } catch {
        // Leave un-pushed; it stays local without an id and retries next pass.
      }
    }

    const removeSet = new Set(plan.removeLocally)
    const newLocal: LocalLink[] = []
    for (const item of plan.keepLocal) {
      if (removeSet.has(item)) continue
      const pushed = pushedIds.get(item)
      newLocal.push(pushed ? { ...item, id: pushed } : item)
    }

    await deps.setLocalLinks(newLocal)
  } catch (err) {
    console.warn("[sync-reconcile] links failed:", (err as Error).message)
  }

  // 2) Bookmark tombstones.
  try {
    const [serverIds, lastSynced] = await Promise.all([
      deps.listServerBookmarkIds(),
      deps.getLastSyncedBookmarkIds()
    ])
    const additions = bookmarkTombstoneAdditions(lastSynced, serverIds)
    if (additions.length > 0) await deps.addBookmarkTombstones(additions)
  } catch (err) {
    console.warn("[sync-reconcile] bookmark tombstones failed:", (err as Error).message)
  }
}
