import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteBookmark, getBookmark, insertBookmark, listAllBookmarksDiffShape,
  listBookmarks, updateBookmark, type BookmarkRow
} from "../db"
import { deleteFor, upsertFor } from "../vectors"

const bookmarks = new Hono<{ Bindings: Env }>()

interface IncomingBookmark {
  id: string
  url: string
  title: string
  parentId?: string | null
  path?: string[]
  category: string
  isFavorite?: boolean
  dateAdded?: number | null
  index?: number | null
}

interface SnapshotBody {
  bookmarks?: IncomingBookmark[]
  pulledAt?: string
}

function embedTextFor(b: IncomingBookmark): string {
  return [b.title, b.url, b.category].filter(Boolean).join("\n")
}

function rowFromIncoming(b: IncomingBookmark, syncedAt: number, chunkCount: number): BookmarkRow {
  return {
    id: b.id,
    url: b.url,
    title: b.title,
    parent_id: b.parentId ?? null,
    path: JSON.stringify(b.path ?? []),
    category: b.category,
    is_favorite: b.isFavorite ? 1 : 0,
    date_added: b.dateAdded ?? null,
    position: b.index ?? null,
    chunk_count: chunkCount,
    synced_at: syncedAt
  }
}

bookmarks.post("/snapshot", async (c) => {
  const body = await c.req.json<SnapshotBody>().catch(() => null)
  if (!body || !Array.isArray(body.bookmarks)) {
    return c.json({ error: { code: "bad_request", message: "bookmarks[] required" } }, 400)
  }
  const incoming = body.bookmarks
  const now = Date.now()

  for (const b of incoming) {
    if (!b || typeof b.id !== "string" || typeof b.url !== "string"
      || typeof b.title !== "string" || typeof b.category !== "string") {
      return c.json({ error: { code: "bad_request", message: "each bookmark needs {id, url, title, category}" } }, 400)
    }
  }

  const existing = new Map(
    (await listAllBookmarksDiffShape(c.env)).map((r) => [r.id, r])
  )
  const incomingIds = new Set(incoming.map((b) => b.id))

  let inserted = 0
  let updated = 0
  let reembedded = 0
  let deleted = 0

  for (const b of incoming) {
    const prev = existing.get(b.id)
    if (prev) {
      const needsEmbed = prev.url !== b.url || prev.title !== b.title || prev.category !== b.category
      let chunkCount = prev.chunk_count
      if (needsEmbed) {
        const r = await upsertFor(c.env, "bookmark", b.id, embedTextFor(b), {
          title: b.title, createdAt: now
        })
        if (r.chunkCount < prev.chunk_count) {
          const ids: string[] = []
          for (let i = r.chunkCount; i < prev.chunk_count; i++) ids.push(`bookmark:${b.id}:${i}`)
          if (ids.length) await c.env.VECTORS.deleteByIds(ids)
        }
        chunkCount = r.chunkCount
        reembedded++
      }
      await updateBookmark(c.env, rowFromIncoming(b, now, chunkCount))
      updated++
    } else {
      const r = await upsertFor(c.env, "bookmark", b.id, embedTextFor(b), {
        title: b.title, createdAt: now
      })
      await insertBookmark(c.env, rowFromIncoming(b, now, r.chunkCount))
      inserted++
      reembedded++
    }
  }

  for (const [id, prev] of existing) {
    if (!incomingIds.has(id)) {
      await deleteFor(c.env, "bookmark", id, prev.chunk_count)
      await deleteBookmark(c.env, id)
      deleted++
    }
  }

  return c.json({
    pulledAt: body.pulledAt ?? null,
    upserted: inserted + updated,
    inserted,
    updated,
    deleted,
    reembedded
  })
})

bookmarks.get("/", async (c) => {
  const category = c.req.query("category") ?? undefined
  const favoriteRaw = c.req.query("favorite")
  const favorite = favoriteRaw === undefined
    ? undefined
    : favoriteRaw === "true" || favoriteRaw === "1"
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const rows = await listBookmarks(c.env, { category, favorite, limit })
  return c.json({ bookmarks: rows })
})

bookmarks.get("/:id", async (c) => {
  const row = await getBookmark(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such bookmark" } }, 404)
  return c.json(row)
})

export default bookmarks
