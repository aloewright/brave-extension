import { Hono } from "hono"
import type { Env } from "../env"
import { deleteLink, getLink, listLinks, upsertLink, type LinkRow } from "../db"
import { deleteFor, upsertFor } from "../vectors"
import { ulid } from "../ulid"

const links = new Hono<{ Bindings: Env }>()

interface PostBody {
  id?: string
  url?: string
  title?: string
  description?: string | null
  tags?: string[]
  favicon?: string | null
  source?: string
}

links.post("/", async (c) => {
  const body = await c.req.json<PostBody>().catch(() => null)
  if (!body || !body.url || !body.title) {
    return c.json({ error: { code: "bad_request", message: "url, title required" } }, 400)
  }
  const now = Date.now()
  const id = body.id ?? ulid()
  const row: LinkRow = {
    id,
    url: body.url,
    title: body.title,
    description: body.description ?? null,
    tags: JSON.stringify(body.tags ?? []),
    favicon: body.favicon ?? null,
    source: body.source ?? "manual",
    chunk_count: 0,
    created_at: now,
    updated_at: now
  }
  const before = await c.env.DB.prepare("SELECT id, chunk_count FROM links WHERE url = ?")
    .bind(body.url)
    .first<{ id: string; chunk_count: number }>()

  const { id: actualId, created } = await upsertLink(c.env, row)

  const embedText = [body.title, body.description ?? "", (body.tags ?? []).join(" ")]
    .filter(Boolean)
    .join("\n")
  const { chunkCount } = await upsertFor(c.env, "link", actualId, embedText, {
    title: body.title, createdAt: now
  })
  if (before && chunkCount < before.chunk_count) {
    const ids: string[] = []
    for (let i = chunkCount; i < before.chunk_count; i++) ids.push(`link:${actualId}:${i}`)
    if (ids.length) await c.env.VECTORS.deleteByIds(ids)
  }
  await c.env.DB.prepare("UPDATE links SET chunk_count = ?, updated_at = ? WHERE id = ?")
    .bind(chunkCount, now, actualId)
    .run()

  return c.json({ id: actualId, created, chunkCount }, created ? 201 : 200)
})

links.get("/", async (c) => {
  const tag = c.req.query("tag") ?? undefined
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined
  const rows = await listLinks(c.env, { tag, limit, before })
  return c.json({ links: rows })
})

links.get("/:id", async (c) => {
  const row = await getLink(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such link" } }, 404)
  return c.json(row)
})

links.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getLink(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "link", id, existing.chunk_count)
  await deleteLink(c.env, id)
  return c.body(null, 204)
})

export default links
