import type { Env } from "./env"
import { ulid } from "./ulid"

export interface SessionRow {
  id: string
  user_id: string
  title: string
  created_at: number
  updated_at: number
}

export interface MessageRow {
  id: string
  session_id: string
  role: string
  content: string
  model: string | null
  created_at: number
}

export async function createSession(
  env: Env,
  userId: string,
  title: string
): Promise<SessionRow> {
  const now = Date.now()
  const row: SessionRow = {
    id: ulid(),
    user_id: userId,
    title,
    created_at: now,
    updated_at: now
  }
  await env.DB.prepare(
    `INSERT INTO agent_sessions (id, user_id, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(row.id, row.user_id, row.title, row.created_at, row.updated_at)
    .run()
  return row
}

export async function listSessions(env: Env, userId: string): Promise<SessionRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM agent_sessions WHERE user_id = ? ORDER BY updated_at DESC`
  )
    .bind(userId)
    .all()
  return (res.results ?? []) as unknown as SessionRow[]
}

export async function getSession(
  env: Env,
  userId: string,
  id: string
): Promise<SessionRow | null> {
  const row = await env.DB.prepare(
    `SELECT * FROM agent_sessions WHERE id = ? AND user_id = ?`
  )
    .bind(id, userId)
    .first()
  return (row as unknown as SessionRow) ?? null
}

export async function insertMessage(
  env: Env,
  m: { sessionId: string; role: string; content: string; model: string | null }
): Promise<MessageRow> {
  const row: MessageRow = {
    id: ulid(),
    session_id: m.sessionId,
    role: m.role,
    content: m.content,
    model: m.model,
    created_at: Date.now()
  }
  const stmt1 = env.DB.prepare(
    `INSERT INTO agent_messages (id, session_id, role, content, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(row.id, row.session_id, row.role, row.content, row.model, row.created_at)
  const stmt2 = env.DB.prepare(`UPDATE agent_sessions SET updated_at = ? WHERE id = ?`).bind(
    row.created_at,
    m.sessionId
  )
  await env.DB.batch([stmt1, stmt2])
  return row
}

export async function listMessages(env: Env, sessionId: string): Promise<MessageRow[]> {
  const res = await env.DB.prepare(
    `SELECT * FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC, id ASC`
  )
    .bind(sessionId)
    .all()
  return (res.results ?? []) as unknown as MessageRow[]
}
