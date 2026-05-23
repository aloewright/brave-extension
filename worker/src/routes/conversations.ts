import { Hono } from "hono"
import type { Env } from "../env"
import {
  deleteConversation, getConversation, insertConversation, listConversations,
  updateConversation, type ConversationRow
} from "../db"
import { deleteFor, upsertFor } from "../vectors"
import { ulid } from "../ulid"

const conversations = new Hono<{ Bindings: Env }>()

interface PostBody {
  id?: string
  backend?: string
  title?: string
  content_text?: string
  started_at?: number
  message_count?: number
}

conversations.post("/", async (c) => {
  const body = await c.req.json<PostBody>().catch(() => null)
  if (!body || !body.backend || !body.title || typeof body.content_text !== "string" || typeof body.started_at !== "number") {
    return c.json({ error: { code: "bad_request", message: "backend, title, content_text, started_at required" } }, 400)
  }
  const now = Date.now()

  if (body.id) {
    const existing = await getConversation(c.env, body.id)
    if (existing) {
      const { chunkCount } = await upsertFor(c.env, "conversation", existing.id, body.content_text, {
        title: body.title, createdAt: existing.started_at
      })
      if (chunkCount < existing.chunk_count) {
        const ids: string[] = []
        for (let i = chunkCount; i < existing.chunk_count; i++) ids.push(`conversation:${existing.id}:${i}`)
        if (ids.length) await c.env.VECTORS.deleteByIds(ids)
      }
      await updateConversation(c.env, existing.id, {
        title: body.title, content_text: body.content_text,
        message_count: body.message_count ?? existing.message_count,
        chunk_count: chunkCount, updated_at: now
      })
      return c.json({ id: existing.id, chunkCount }, 200)
    }
  }

  const id = body.id ?? ulid()
  const row: ConversationRow = {
    id, backend: body.backend, title: body.title, content_text: body.content_text,
    message_count: body.message_count ?? 0, chunk_count: 0,
    started_at: body.started_at, updated_at: now
  }
  await insertConversation(c.env, row)
  const { chunkCount } = await upsertFor(c.env, "conversation", id, body.content_text, {
    title: body.title, createdAt: body.started_at
  })
  if (chunkCount !== 0) {
    await updateConversation(c.env, id, { chunk_count: chunkCount, updated_at: now })
  }
  return c.json({ id, chunkCount }, 201)
})

conversations.get("/", async (c) => {
  const backend = c.req.query("backend") ?? undefined
  const limit = c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  const before = c.req.query("before") ? Number(c.req.query("before")) : undefined
  const rows = await listConversations(c.env, { backend, limit, before })
  return c.json({ conversations: rows })
})

conversations.get("/:id", async (c) => {
  const row = await getConversation(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such conversation" } }, 404)
  return c.json(row)
})

interface PutBody {
  title?: string
  content_text?: string
  message_count?: number
}

conversations.put("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getConversation(c.env, id)
  if (!existing) return c.json({ error: { code: "not_found", message: "no such conversation" } }, 404)
  const body = await c.req.json<PutBody>().catch(() => null)
  if (!body) return c.json({ error: { code: "bad_request", message: "json body required" } }, 400)

  const now = Date.now()
  const nextContent = body.content_text ?? existing.content_text
  const nextTitle = body.title ?? existing.title

  const { chunkCount } = await upsertFor(c.env, "conversation", id, nextContent, {
    title: nextTitle, createdAt: existing.started_at
  })
  if (chunkCount < existing.chunk_count) {
    const ids: string[] = []
    for (let i = chunkCount; i < existing.chunk_count; i++) ids.push(`conversation:${id}:${i}`)
    if (ids.length) await c.env.VECTORS.deleteByIds(ids)
  }
  await updateConversation(c.env, id, {
    title: nextTitle, content_text: nextContent,
    message_count: body.message_count ?? existing.message_count,
    chunk_count: chunkCount, updated_at: now
  })
  return c.json({ id, chunkCount })
})

conversations.delete("/:id", async (c) => {
  const id = c.req.param("id")
  const existing = await getConversation(c.env, id)
  if (!existing) return c.body(null, 204)
  await deleteFor(c.env, "conversation", id, existing.chunk_count)
  await deleteConversation(c.env, id)
  return c.body(null, 204)
})

export default conversations
