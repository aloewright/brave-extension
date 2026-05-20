import { getSettings } from "../storage"
import { createSidebarApiClient } from "../lib/sidebar-api"

interface LinkLike {
  id?: string
  url: string
  title: string
  description?: string | null
  tags?: string[]
  favicon?: string | null
  source?: string
}

/**
 * Fire-and-forget mirror of a saved link into the sidebar-api Worker.
 * The lx storage module should call this after `setLinks()` writes the
 * canonical state to chrome.storage so the link surfaces in /api/search.
 *
 * Returns the server's `{ id, created }` shape on success, or a
 * `{ uploaded: false }` envelope on any failure — never throws so the
 * extension's local write path stays unaffected.
 */
export async function syncLink(link: LinkLike): Promise<
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
    const res = await client.links.upsert({
      id: link.id,
      url: link.url,
      title: link.title,
      description: link.description ?? null,
      tags: link.tags ?? [],
      favicon: link.favicon ?? null,
      source: link.source ?? "manual"
    })
    return { uploaded: true, id: res.id, created: res.created }
  } catch (err) {
    return { uploaded: false, reason: (err as Error).message }
  }
}

/**
 * Diff helper for the lx `setLinks` wrapper: returns links present in
 * `next` whose `id` is missing from `prev`, OR whose `url`/`title`
 * changed. The wrapper iterates these and calls syncLink on each.
 */
export function changedLinks<T extends { id?: string; url: string; title: string }>(
  prev: T[],
  next: T[]
): T[] {
  const prevById = new Map<string, T>()
  for (const l of prev) if (l.id) prevById.set(l.id, l)
  const out: T[] = []
  for (const l of next) {
    const p = l.id ? prevById.get(l.id) : undefined
    if (!p) { out.push(l); continue }
    if (p.url !== l.url || p.title !== l.title) out.push(l)
  }
  return out
}
