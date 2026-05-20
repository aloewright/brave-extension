/**
 * Bookmarks + library MCP tool handlers (ALO-246, M5).
 *
 * Bookmarks bridge to chrome.bookmarks. Library links + captures live in
 * chrome.storage.local at `lx_collectedLinks` (existing, see _lx/storage.ts)
 * and `lx_captures` (new key reserved for capture metadata + bodies).
 *
 * Result shape: `{ content: [{type, text}], isError?: boolean }`.
 */

type ToolResult = {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

export const LX_LINKS_KEY = "lx_collectedLinks"
export const LX_CAPTURES_KEY = "lx_captures"

const CAPTURE_BODY_CAP = 256 * 1024 // 256KB

function ok(text: string): ToolResult {
  return { isError: false, content: [{ type: "text", text }] }
}

function err(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

function rid(prefix: string): string {
  // Cheap, no-deps id. Consistent with existing _lx CollectedLink ids.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// In-process serializer keyed on storage key. Prevents read-modify-write
// races when multiple tool calls mutate the same storage list concurrently.
const writeLocks = new Map<string, Promise<unknown>>()
function withStorageLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve()
  const next = prev.then(
    () => fn(),
    () => fn()
  )
  writeLocks.set(
    key,
    next.finally(() => {
      if (writeLocks.get(key) === next) writeLocks.delete(key)
    })
  )
  return next
}

// Chrome bookmark IDs are numeric strings. Normalize + reject anything else.
function normalizeBookmarkId(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim()
  if (!/^\d+$/.test(t)) return undefined
  return t
}

// ── Bookmarks ────────────────────────────────────────────────────────────

async function bookmarks_search(args: any): Promise<ToolResult> {
  const query = String(args?.query ?? "")
  if (!query) return err("query required")
  const maxResults = Number(args?.maxResults ?? 50)
  try {
    const results = await chrome.bookmarks.search(query)
    const shaped = results.slice(0, maxResults).map((b) => ({
      id: b.id,
      title: b.title,
      url: b.url,
      parentId: b.parentId
    }))
    return ok(JSON.stringify(shaped, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function bookmarks_create(args: any): Promise<ToolResult> {
  const title = String(args?.title ?? "")
  if (!title) return err("title required")
  let parentId: string | undefined
  if (args?.parentId !== undefined && args?.parentId !== null) {
    parentId = normalizeBookmarkId(args.parentId)
    if (!parentId) return err("invalid parentId")
  }
  try {
    const node = await chrome.bookmarks.create({
      parentId,
      title,
      url: args?.url,
      index: typeof args?.index === "number" ? args.index : undefined
    })
    return ok(
      JSON.stringify(
        { id: node.id, title: node.title, url: node.url, parentId: node.parentId },
        null,
        2
      )
    )
  } catch (e) {
    return err((e as Error).message)
  }
}

async function bookmarks_remove(args: any): Promise<ToolResult> {
  const id = normalizeBookmarkId(args?.id)
  if (!id) return err("invalid id")
  const recursive = !!args?.recursive
  try {
    if (recursive) await chrome.bookmarks.removeTree(id)
    else await chrome.bookmarks.remove(id)
    return ok(JSON.stringify({ removed: id, recursive }))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function bookmarks_move(args: any): Promise<ToolResult> {
  const id = normalizeBookmarkId(args?.id)
  if (!id) return err("invalid id")
  const dest: { parentId?: string; index?: number } = {}
  if (args?.parentId !== undefined && args?.parentId !== null) {
    const parentId = normalizeBookmarkId(args.parentId)
    if (!parentId) return err("invalid parentId")
    dest.parentId = parentId
  }
  if (typeof args?.index === "number") dest.index = args.index
  try {
    const node = await chrome.bookmarks.move(id, dest)
    return ok(
      JSON.stringify({ id: node.id, parentId: node.parentId, index: node.index }, null, 2)
    )
  } catch (e) {
    return err((e as Error).message)
  }
}

// ── Library links ────────────────────────────────────────────────────────

interface StoredLink {
  id: string
  url: string
  title?: string
  date?: string
  tags?: string[]
  // Plasmo's existing _lx CollectedLink uses these fields too — we tolerate
  // both shapes by reading the legacy `date` and exposing `addedAt`.
}

async function readLinks(): Promise<StoredLink[]> {
  const r = await chrome.storage.local.get(LX_LINKS_KEY)
  const v = r?.[LX_LINKS_KEY]
  return Array.isArray(v) ? (v as StoredLink[]) : []
}

async function writeLinks(list: StoredLink[]): Promise<void> {
  await chrome.storage.local.set({ [LX_LINKS_KEY]: list })
}

function shapeLink(l: StoredLink) {
  return {
    id: l.id,
    url: l.url,
    title: l.title ?? "",
    addedAt: l.date ?? null,
    tags: l.tags ?? []
  }
}

async function links_list(args: any): Promise<ToolResult> {
  const limit = Number(args?.limit ?? 0)
  try {
    const list = await readLinks()
    const slice = limit > 0 ? list.slice(0, limit) : list
    return ok(JSON.stringify(slice.map(shapeLink), null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function links_add(args: any): Promise<ToolResult> {
  const url = String(args?.url ?? "")
  if (!url) return err("url required")
  const tags = Array.isArray(args?.tags) ? args.tags.map(String) : []
  return withStorageLock(LX_LINKS_KEY, async () => {
    try {
      const list = await readLinks()
      const link: StoredLink = {
        id: rid("link"),
        url,
        title: args?.title ? String(args.title) : "",
        tags,
        date: new Date().toISOString()
      }
      list.unshift(link)
      await writeLinks(list)
      return ok(JSON.stringify(shapeLink(link), null, 2))
    } catch (e) {
      return err((e as Error).message)
    }
  })
}

async function links_remove(args: any): Promise<ToolResult> {
  const id = String(args?.id ?? "")
  if (!id) return err("id required")
  return withStorageLock(LX_LINKS_KEY, async () => {
    try {
      const list = await readLinks()
      const next = list.filter((l) => l.id !== id)
      if (next.length === list.length) return err(`no link ${id}`)
      await writeLinks(next)
      return ok(JSON.stringify({ removed: id }))
    } catch (e) {
      return err((e as Error).message)
    }
  })
}

// ── Library captures ─────────────────────────────────────────────────────

interface StoredCapture {
  id: string
  url: string
  title?: string
  capturedAt: string
  html?: string
  text?: string
}

async function readCaptures(): Promise<StoredCapture[]> {
  const r = await chrome.storage.local.get(LX_CAPTURES_KEY)
  const v = r?.[LX_CAPTURES_KEY]
  return Array.isArray(v) ? (v as StoredCapture[]) : []
}

function captureMeta(c: StoredCapture) {
  return {
    id: c.id,
    url: c.url,
    title: c.title ?? "",
    capturedAt: c.capturedAt,
    byteSize: typeof c.html === "string" ? c.html.length : 0
  }
}

async function captures_list(args: any): Promise<ToolResult> {
  const limit = Number(args?.limit ?? 0)
  try {
    const list = await readCaptures()
    const slice = limit > 0 ? list.slice(0, limit) : list
    return ok(JSON.stringify(slice.map(captureMeta), null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function captures_get(args: any): Promise<ToolResult> {
  const id = String(args?.id ?? "")
  if (!id) return err("id required")
  try {
    const list = await readCaptures()
    const c = list.find((x) => x.id === id)
    if (!c) return err(`no capture ${id}`)
    const html = typeof c.html === "string" ? c.html : ""
    const truncated = html.length > CAPTURE_BODY_CAP
    const body = truncated ? html.slice(0, CAPTURE_BODY_CAP) : html
    return ok(
      JSON.stringify(
        {
          id: c.id,
          url: c.url,
          title: c.title ?? "",
          capturedAt: c.capturedAt,
          text: c.text ?? "",
          html: body,
          truncated,
          originalByteSize: html.length
        },
        null,
        2
      )
    )
  } catch (e) {
    return err((e as Error).message)
  }
}

export const LIBRARY_TOOL_HANDLERS: Record<
  string,
  (args: any) => Promise<ToolResult>
> = {
  bookmarks_search,
  bookmarks_create,
  bookmarks_remove,
  bookmarks_move,
  links_list,
  links_add,
  links_remove,
  captures_list,
  captures_get
}
