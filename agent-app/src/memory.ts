import type { Env } from "./env"
import { AI_GATEWAY_ID } from "./env"
import { ulid } from "./ulid"
import { collectCompletion, type ChatMsg } from "./chat"
import { DEFAULT_MODEL_ID } from "./models"

// Embedding model routed through gateway "x" (CLAUDE.md sanctioned env.AI.run).
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5"

export interface MemoryRow {
  id: string
  user_id: string
  session_id: string | null
  kind: string
  content: string
  hindsight_ref: string | null
  created_at: number
}

export async function embed(env: Env, text: string): Promise<number[]> {
  const res = (await env.AI.run(
    EMBED_MODEL,
    { text: [text] },
    { gateway: { id: AI_GATEWAY_ID } }
  )) as { data: number[][] }
  return res?.data?.[0] ?? []
}

export async function retainMemory(
  env: Env,
  m: { userId: string; sessionId: string | null; kind: string; content: string }
): Promise<MemoryRow> {
  const row: MemoryRow = {
    id: ulid(),
    user_id: m.userId,
    session_id: m.sessionId,
    kind: m.kind,
    content: m.content,
    hindsight_ref: null,
    created_at: Date.now()
  }
  await env.DB.prepare(
    `INSERT INTO agent_memories (id, user_id, session_id, kind, content, hindsight_ref, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(row.id, row.user_id, row.session_id, row.kind, row.content, row.hindsight_ref, row.created_at)
    .run()

  const values = await embed(env, m.content)
  if (values.length) {
    await env.VECTORS.upsert([
      {
        id: `mem:${row.id}`,
        values,
        metadata: { type: "agent_memory", user_id: m.userId, memId: row.id, kind: m.kind }
      }
    ])
  }
  return row
}

export async function recallMemories(
  env: Env,
  userId: string,
  query: string,
  topK = 5
): Promise<MemoryRow[]> {
  const qvec = await embed(env, query)
  if (!qvec.length) return []
  const res = await env.VECTORS.query(qvec, {
    topK,
    filter: { type: "agent_memory", user_id: userId },
    returnMetadata: true
  } as VectorizeQueryOptions)
  const ids = (res.matches ?? [])
    .map((mch) => (mch.metadata as { memId?: string } | undefined)?.memId)
    .filter((x): x is string => typeof x === "string")
  if (!ids.length) return []
  const placeholders = ids.map(() => "?").join(",")
  const rows = await env.DB.prepare(
    `SELECT * FROM agent_memories WHERE id IN (${placeholders})`
  )
    .bind(...ids)
    .all()
  const byId = new Map((rows.results as unknown as MemoryRow[]).map((r) => [r.id, r]))
  // Preserve the relevance order from the vector query.
  return ids.map((id) => byId.get(id)).filter((r): r is MemoryRow => !!r)
}

/**
 * Summarize the latest exchange into a durable memory. Best-effort: failures
 * are swallowed so a reflection error never breaks a chat turn.
 */
export async function reflect(
  env: Env,
  userId: string,
  sessionId: string,
  recent: ChatMsg[]
): Promise<void> {
  try {
    const transcript = recent.map((m) => `${m.role}: ${m.content}`).join("\n")
    const summary = await collectCompletion(
      env,
      DEFAULT_MODEL_ID,
      [
        {
          role: "system",
          content:
            "Extract one durable fact about the user or task worth remembering for future conversations. Reply with the single fact only, or 'NONE' if nothing is worth retaining."
        },
        { role: "user", content: transcript }
      ],
      false
    )
    const fact = summary.trim()
    if (fact && fact.toUpperCase() !== "NONE") {
      await retainMemory(env, { userId, sessionId, kind: "reflection", content: fact })
    }
  } catch {
    /* reflection is best-effort */
  }
}
