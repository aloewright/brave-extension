import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteHighlight,
  getHighlight,
  listHighlights,
  updateHighlight,
  upsertHighlight,
  type HighlightRow
} from "../db"
import { deleteFor, upsertFor } from "../vectors"
import { ulid } from "../ulid"

const highlights = new Hono<{ Bindings: Env }>()

interface HighlightBody {
  id?: string
  text?: string
  note?: string | null
  tags?: string[]
  sourceUrl?: string | null
  sourceTitle?: string | null
  sourceFavicon?: string | null
  contextBefore?: string | null
  contextAfter?: string | null
  source?: string
  createdAt?: number
}

function cleanText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function cleanNullable(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return Array.from(new Set(value.map((t) => String(t).trim()).filter(Boolean))).slice(0, 20)
}

function hostFromUrl(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function createdAtFrom(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

function rowFromBody(body: HighlightBody, now: number): HighlightRow | null {
  const text = cleanText(body.text)
  if (!text) return null
  const sourceUrl = cleanNullable(body.sourceUrl)
  return {
    id: cleanText(body.id) ?? ulid(),
    text,
    note: cleanNullable(body.note),
    tags: JSON.stringify(cleanTags(body.tags)),
    source_url: sourceUrl,
    source_title: cleanNullable(body.sourceTitle),
    source_host: hostFromUrl(sourceUrl),
    source_favicon: cleanNullable(body.sourceFavicon),
    context_before: cleanNullable(body.contextBefore),
    context_after: cleanNullable(body.contextAfter),
    source: cleanText(body.source) ?? "extension",
    chunk_count: 0,
    created_at: createdAtFrom(body.createdAt, now),
    updated_at: now
  }
}

function embedTextFor(row: HighlightRow): string {
  let tags: string[] = []
  try {
    const parsed = JSON.parse(row.tags)
    if (Array.isArray(parsed)) tags = parsed.map(String)
  } catch {
    tags = []
  }
  return [
    row.text,
    row.note ?? "",
    row.source_title ?? "",
    row.source_url ?? "",
    row.context_before ?? "",
    row.context_after ?? "",
    tags.join(" ")
  ].filter(Boolean).join("\n")
}

async function reindexHighlight(env: Env, row: HighlightRow, previousChunkCount: number): Promise<number> {
  const { chunkCount } = await upsertFor(env, "highlight", row.id, embedTextFor(row), {
    title: row.source_title ?? row.source_host ?? "Highlight",
    createdAt: row.created_at
  })
  if (chunkCount < previousChunkCount) {
    const ids: string[] = []
    for (let i = chunkCount; i < previousChunkCount; i++) ids.push(`highlight:${row.id}:${i}`)
    if (ids.length) await env.VECTORS.deleteByIds(ids)
  }
  return chunkCount
}

highlights.post("/", async (c) => {
  const body = await c.req.json<HighlightBody>().catch(() => null)
  if (!body) return c.json({ error: { code: "bad_request", message: "json body required" } }, 400)

  const now = Date.now()
  const row = rowFromBody(body, now)
  if (!row) return c.json({ error: { code: "bad_request", message: "text required" } }, 400)

  const { id, created, previousChunkCount } = await upsertHighlight(c.env, row)
  row.id = id
  const chunkCount = await reindexHighlight(c.env, row, previousChunkCount)
  await updateHighlight(c.env, id, { chunk_count: chunkCount, updated_at: now })

  return c.json({ id, created, chunkCount }, created ? 201 : 200)
})

highlights.get("/", async (c) => {
  const host = c.req.query("host") ?? undefined
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined
  const rows = await listHighlights(c.env, { host, limit, before })
  return c.json({ highlights: rows })
})

highlights.get("/:id", async (c) => {
  const row = await getHighlight(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such highlight" } }, 404)
  return c.json(row)
})

highlights.patch("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getHighlight(c.env, id)
  if (!existing) return c.json({ error: { code: "not_found", message: "no such highlight" } }, 404)

  const body = await c.req.json<HighlightBody>().catch(() => null)
  if (!body) return c.json({ error: { code: "bad_request", message: "json body required" } }, 400)

  const next: HighlightRow = { ...existing, updated_at: Date.now() }
  if ("text" in body) {
    const text = cleanText(body.text)
    if (!text) return c.json({ error: { code: "bad_request", message: "text cannot be empty" } }, 400)
    next.text = text
  }
  if ("note" in body) next.note = cleanNullable(body.note)
  if ("tags" in body) next.tags = JSON.stringify(cleanTags(body.tags))
  if ("sourceUrl" in body) {
    next.source_url = cleanNullable(body.sourceUrl)
    next.source_host = hostFromUrl(next.source_url)
  }
  if ("sourceTitle" in body) next.source_title = cleanNullable(body.sourceTitle)
  if ("sourceFavicon" in body) next.source_favicon = cleanNullable(body.sourceFavicon)
  if ("contextBefore" in body) next.context_before = cleanNullable(body.contextBefore)
  if ("contextAfter" in body) next.context_after = cleanNullable(body.contextAfter)
  if ("source" in body) next.source = cleanText(body.source) ?? "extension"

  const chunkCount = await reindexHighlight(c.env, next, existing.chunk_count)
  await updateHighlight(c.env, id, {
    text: next.text,
    note: next.note,
    tags: next.tags,
    source_url: next.source_url,
    source_title: next.source_title,
    source_host: next.source_host,
    source_favicon: next.source_favicon,
    context_before: next.context_before,
    context_after: next.context_after,
    source: next.source,
    chunk_count: chunkCount,
    updated_at: next.updated_at
  })

  return c.json((await getHighlight(c.env, id))!)
})

highlights.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getHighlight(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "highlight", id, existing.chunk_count)
  await deleteHighlight(c.env, id)
  return c.body(null, 204)
})

export default highlights
