import { Hono } from "hono"
import type { Env } from "../env"
import { createSession, getSession, listSessions, listMessages } from "../db"

type Vars = { userId: string }
const sessions = new Hono<{ Bindings: Env; Variables: Vars }>()

// List the caller's sessions.
sessions.get("/", async (c) => {
  const rows = await listSessions(c.env, c.get("userId"))
  return c.json({ sessions: rows })
})

// Create a session.
sessions.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { title?: string }
  const row = await createSession(c.env, c.get("userId"), body.title?.trim() || "New chat")
  return c.json({ session: row })
})

// List messages in a session (ownership enforced).
sessions.get("/:id/messages", async (c) => {
  const sess = await getSession(c.env, c.get("userId"), c.req.param("id"))
  if (!sess) return c.json({ error: { code: "not_found", message: "no such session" } }, 404)
  const msgs = await listMessages(c.env, sess.id)
  return c.json({ messages: msgs })
})

// Send a message → routed to the ChatAgent DO (one instance per session id).
sessions.post("/:id/messages", async (c) => {
  const sess = await getSession(c.env, c.get("userId"), c.req.param("id"))
  if (!sess) return c.json({ error: { code: "not_found", message: "no such session" } }, 404)
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: unknown
    modelId?: string
    advanced?: boolean
  }
  if (typeof body.content !== "string" || !body.content.trim()) {
    return c.json({ error: { code: "bad_request", message: "content required" } }, 400)
  }
  const modelId =
    body.modelId ?? (await c.env.AGENT_KV.get(`pref:model:${c.get("userId")}`)) ?? undefined

  const id = c.env.CHAT_AGENT.idFromName(sess.id)
  const stub = c.env.CHAT_AGENT.get(id)
  try {
    const res = await stub.fetch(
      new Request("https://agent/internal/turn", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sess.id,
          content: body.content,
          modelId,
          advanced: body.advanced === true
        })
      })
    )
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch {
    return c.json(
      { error: { code: "service_unavailable", message: "Agent is currently unavailable" } },
      503
    )
  }
})

// Streamed send: forwards SSE deltas from the ChatAgent DO.
sessions.post("/:id/messages/stream", async (c) => {
  const sess = await getSession(c.env, c.get("userId"), c.req.param("id"))
  if (!sess) return c.json({ error: { code: "not_found", message: "no such session" } }, 404)
  const body = (await c.req.json().catch(() => ({}))) as {
    content?: string
    modelId?: string
    advanced?: boolean
  }
  if (!body.content?.trim()) {
    return c.json({ error: { code: "bad_request", message: "content required" } }, 400)
  }
  const modelId =
    body.modelId ?? (await c.env.AGENT_KV.get(`pref:model:${c.get("userId")}`)) ?? undefined

  const id = c.env.CHAT_AGENT.idFromName(sess.id)
  const stub = c.env.CHAT_AGENT.get(id)
  try {
    const res = await stub.fetch(
      new Request("https://agent/internal/turn/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId: sess.id,
          content: body.content,
          modelId,
          advanced: body.advanced === true
        })
      })
    )
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache"
      }
    })
  } catch {
    return c.json(
      { error: { code: "service_unavailable", message: "Agent is currently unavailable" } },
      503
    )
  }
})

export default sessions
