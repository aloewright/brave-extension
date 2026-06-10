import { Hono } from "hono"
import type { Env } from "../env"

interface NoteRow {
  id: string
  title: string
  text: string
  tags: string
  source: string
  created_at: number
  updated_at: number
  chunk_count: number
}

interface NotePayload {
  id?: unknown
  title?: unknown
  text?: unknown
  body?: unknown
  content?: unknown
  tags?: unknown
  source?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  created_at?: unknown
  updated_at?: unknown
}

const NOTE_COLUMNS = "id, title, text, tags, source, created_at, updated_at, chunk_count"
const MAX_LIMIT = 200

const notes = new Hono<{ Bindings: Env }>()

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function clampLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10)
  if (!Number.isFinite(parsed)) return 100
  return Math.min(Math.max(parsed, 1), MAX_LIMIT)
}

function toMillis(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return numeric
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function normalizeTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((tag) => String(tag).trim()).filter(Boolean)
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return parsed.map((tag) => String(tag).trim()).filter(Boolean)
      }
    } catch {
      return value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    }
  }
  return []
}

function noteTitle(text: string, title?: string): string {
  const requested = title?.trim()
  if (requested) return requested.slice(0, 160)
  const firstLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean)
  return (firstLine || "Session note").slice(0, 160)
}

function publicNote(row: NoteRow) {
  return {
    ...row,
    tags: normalizeTags(row.tags),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function getNote(env: Env, id: string): Promise<NoteRow | null> {
  return await env.DB.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`).bind(id).first<NoteRow>()
}

async function upsertNote(env: Env, row: NoteRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notes (id, title, text, tags, source, created_at, updated_at, chunk_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       text = excluded.text,
       tags = excluded.tags,
       source = excluded.source,
       updated_at = excluded.updated_at,
       chunk_count = notes.chunk_count`,
  )
    .bind(row.id, row.title, row.text, row.tags, row.source, row.created_at, row.updated_at, row.chunk_count)
    .run()
}

function rowFromPayload(payload: NotePayload, existing?: NoteRow | null): NoteRow {
  const now = Date.now()
  const text = asText(payload.text ?? payload.body ?? payload.content)
  const id = asString(payload.id) || existing?.id || crypto.randomUUID()
  const createdAt = toMillis(payload.createdAt ?? payload.created_at, existing?.created_at ?? now)
  const updatedAt = toMillis(payload.updatedAt ?? payload.updated_at, now)
  const tags = normalizeTags(payload.tags)

  return {
    id,
    title: noteTitle(text, asString(payload.title) || existing?.title),
    text,
    tags: JSON.stringify(tags),
    source: asString(payload.source) || existing?.source || "session",
    created_at: createdAt,
    updated_at: updatedAt,
    chunk_count: existing?.chunk_count ?? 0,
  }
}

notes.get("/", async (c) => {
  const limit = clampLimit(c.req.query("limit"))
  const before = toMillis(c.req.query("before"), Number.POSITIVE_INFINITY)
  const source = asString(c.req.query("source"))

  const params: unknown[] = []
  const where: string[] = []

  if (Number.isFinite(before)) {
    where.push("updated_at < ?")
    params.push(before)
  }

  if (source) {
    where.push("source = ?")
    params.push(source)
  }

  params.push(limit)
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const result = await c.env.DB.prepare(
    `SELECT ${NOTE_COLUMNS} FROM notes ${whereSql} ORDER BY updated_at DESC LIMIT ?`,
  )
    .bind(...params)
    .all<NoteRow>()

  const rows = result.results ?? []
  const last = rows.at(-1)
  return c.json({ notes: rows.map(publicNote), nextBefore: last?.updated_at ?? null })
})

notes.post("/", async (c) => {
  const payload = (await c.req.json().catch(() => ({}))) as NotePayload
  const requestedId = asString(payload.id)
  const existing = requestedId ? await getNote(c.env, requestedId) : null
  const row = rowFromPayload(payload, existing)
  await upsertNote(c.env, row)
  return c.json({ id: row.id, created: !existing, chunkCount: row.chunk_count, note: publicNote(row) }, existing ? 200 : 201)
})

notes.get("/:id", async (c) => {
  const row = await getNote(c.env, c.req.param("id"))
  if (!row) return c.json({ error: "Note not found" }, 404)
  return c.json(publicNote(row))
})

notes.put("/:id", async (c) => {
  const existing = await getNote(c.env, c.req.param("id"))
  if (!existing) return c.json({ error: "Note not found" }, 404)
  const payload = (await c.req.json().catch(() => ({}))) as NotePayload
  const row = rowFromPayload({ ...payload, id: existing.id }, existing)
  await upsertNote(c.env, row)
  return c.json(publicNote(row))
})

notes.delete("/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(c.req.param("id")).run()
  return c.json({ ok: true })
})

export default notes
