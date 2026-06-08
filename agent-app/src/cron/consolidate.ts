import type { Env } from "../env"
import { collectCompletion } from "../chat"
import { DEFAULT_MODEL_ID } from "../models"
import { retainMemory } from "../memory"
import { log } from "../log"

const SYSTEM_PROMPT =
  "Extract durable facts, preferences, and open threads about the user as terse bullet points. If nothing durable, reply NONE."

interface NewMessageRow {
  role: string
  content: string
  created_at: number
}

/** DISTINCT active user ids, most-recently-active first. */
async function activeUsers(env: Env, limit: number): Promise<string[]> {
  const res = await env.DB.prepare(
    `SELECT DISTINCT user_id FROM agent_sessions ORDER BY updated_at DESC LIMIT ?`
  )
    .bind(limit)
    .all()
  return ((res.results ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)
}

/**
 * Self-reflection memory consolidation. For each active user, distills their
 * messages since the last watermark into a durable "reflection" memory, then
 * advances the per-user KV watermark so the next run only sees new messages.
 * Watermark-gated and idempotent; one user's failure never aborts the loop.
 */
export async function consolidateMemories(
  env: Env,
  opts: { maxUsers: number; maxMessagesPerUser: number }
): Promise<{ usersProcessed: number; usersFailed: number; skipped: number }> {
  const startedAt = Date.now()
  let usersProcessed = 0
  let usersFailed = 0
  let skipped = 0

  const users = await activeUsers(env, opts.maxUsers)

  for (const userId of users) {
    try {
      const wmKey = `consolidate:wm:${userId}`
      const wmRaw = await env.AGENT_KV.get(wmKey)
      const watermark = wmRaw ? Number(wmRaw) : 0

      const res = await env.DB.prepare(
        `SELECT m.role, m.content, m.created_at
         FROM agent_messages m
         JOIN agent_sessions s ON s.id = m.session_id
         WHERE s.user_id = ? AND m.created_at > ?
         ORDER BY m.created_at ASC
         LIMIT ?`
      )
        .bind(userId, watermark, opts.maxMessagesPerUser)
        .all()
      const rows = (res.results ?? []) as unknown as NewMessageRow[]

      if (rows.length === 0) {
        skipped++
        continue
      }

      const transcript = rows.map((r) => `${r.role}: ${r.content}`).join("\n")
      const distilled = await collectCompletion(
        env,
        DEFAULT_MODEL_ID,
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: transcript }
        ],
        false
      )

      const trimmed = distilled.trim()
      if (trimmed && trimmed.toUpperCase() !== "NONE") {
        await retainMemory(env, {
          userId,
          sessionId: null,
          kind: "reflection",
          content: trimmed
        })
      }

      const lastCreatedAt = rows[rows.length - 1]!.created_at
      await env.AGENT_KV.put(wmKey, String(lastCreatedAt))
      usersProcessed++
    } catch (err) {
      usersFailed++
      log.error("cron.consolidate.user_failed", {
        userId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  log.info("cron.consolidate.done", {
    usersProcessed,
    usersFailed,
    skipped,
    total: users.length,
    ms: Date.now() - startedAt
  })
  if (users.length >= opts.maxUsers) {
    log.warn("cron.consolidate.capped", { cap: opts.maxUsers })
  }

  return { usersProcessed, usersFailed, skipped }
}
