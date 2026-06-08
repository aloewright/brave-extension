import type { Env } from "../env"
import { collectCompletion } from "../chat"
import { DEFAULT_MODEL_ID } from "../models"
import { retainMemory } from "../memory"
import { log } from "../log"

const SYSTEM_PROMPT =
  "Extract durable facts, preferences, and open threads about the user as terse bullet points. If nothing durable, reply NONE."

interface NewMessageRow {
  id: string
  role: string
  content: string
  created_at: number
}

/** Per-message content cap; longer content is truncated with an ellipsis. */
const MAX_CONTENT_CHARS = 500
/** Total transcript cap; when exceeded we keep the most RECENT messages that fit. */
const MAX_TRANSCRIPT_CHARS = 20_000
/** Max pages fetched per user per tick, to bound work. */
const MAX_PAGES_PER_USER = 5
/** Per-user processing timeout. */
const USER_TIMEOUT_MS = 8_000
/** Total elapsed budget before we stop starting new users this tick. */
const TIME_BUDGET_MS = 25_000

/**
 * Build a transcript from messages, capping each message's content and the
 * total length. When the total cap is exceeded we keep the most recent lines.
 */
function buildTranscript(rows: NewMessageRow[]): string {
  const lines = rows.map((r) => {
    let content = r.content
    if (content.length > MAX_CONTENT_CHARS) {
      content = content.slice(0, MAX_CONTENT_CHARS) + "…"
    }
    return `${r.role}: ${content}`
  })
  let joined = lines.join("\n")
  if (joined.length > MAX_TRANSCRIPT_CHARS) {
    // Keep the most recent lines that fit (recency matters most).
    const kept: string[] = []
    let total = 0
    for (let i = lines.length - 1; i >= 0; i--) {
      const addition = (kept.length === 0 ? 0 : 1) + lines[i]!.length // +1 for newline
      if (total + addition > MAX_TRANSCRIPT_CHARS) break
      kept.push(lines[i]!)
      total += addition
    }
    kept.reverse()
    joined = kept.join("\n")
  }
  return joined
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

interface UserResult {
  processedAnyPage: boolean
}

/**
 * Process all new messages for one user within this tick.
 *
 * Paging / cursor approach (chosen to PROVABLY never permanently skip a
 * message and never reprocess one): we page with a composite cursor
 * `(created_at, id)` using `ORDER BY created_at ASC, id ASC` and a strict
 * composite comparison `created_at > c OR (created_at = c AND id > i)`. Because
 * `(created_at, id)` is a total order over rows, strict `>` advances past
 * exactly the processed rows — two rows sharing a created_at are ordered by id
 * and never collapsed, so the boundary case that broke a created_at-only `>`
 * cannot occur. The composite cursor is persisted to KV as `"<created_at>:<id>"`
 * so the next tick resumes exactly where this one stopped. The cap on
 * pages-per-tick can defer (never drop) rows: the cursor is left advanced to
 * the last processed row, so the next tick continues from there — deferral,
 * not a permanent skip.
 */
async function processUser(
  env: Env,
  userId: string,
  maxMessagesPerUser: number
): Promise<UserResult> {
  const wmKey = `consolidate:wm:${userId}`
  const wmRaw = await env.AGENT_KV.get(wmKey)
  // Watermark format: "<created_at>:<id>". Legacy/empty => start from the top.
  let cursorCreatedAt = 0
  let cursorId = ""
  if (wmRaw) {
    const sep = wmRaw.indexOf(":")
    if (sep === -1) {
      cursorCreatedAt = Number(wmRaw) // legacy created_at-only watermark
    } else {
      cursorCreatedAt = Number(wmRaw.slice(0, sep))
      cursorId = wmRaw.slice(sep + 1)
    }
  }
  let processedAnyPage = false

  for (let page = 0; page < MAX_PAGES_PER_USER; page++) {
    const res = await env.DB.prepare(
      `SELECT m.id, m.role, m.content, m.created_at
       FROM agent_messages m
       JOIN agent_sessions s ON s.id = m.session_id
       WHERE s.user_id = ?
         AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT ?`
    )
      .bind(userId, cursorCreatedAt, cursorCreatedAt, cursorId, maxMessagesPerUser)
      .all()
    const rows = (res.results ?? []) as unknown as NewMessageRow[]
    if (rows.length === 0) break

    const transcript = buildTranscript(rows)
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

    const last = rows[rows.length - 1]!
    cursorCreatedAt = last.created_at
    cursorId = last.id
    await env.AGENT_KV.put(wmKey, `${last.created_at}:${last.id}`)
    processedAnyPage = true

    if (rows.length < maxMessagesPerUser) break // caught up
    if (page === MAX_PAGES_PER_USER - 1) {
      log.warn("cron.consolidate.user_truncated", { userId, pages: MAX_PAGES_PER_USER })
    }
  }

  return { processedAnyPage }
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
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      log.warn("cron.consolidate.time_budget", { processed: usersProcessed })
      break
    }
    try {
      await Promise.race([
        processUser(env, userId, opts.maxMessagesPerUser),
        new Promise<UserResult>((_, reject) =>
          setTimeout(() => reject(new Error("user consolidation timeout")), USER_TIMEOUT_MS)
        )
      ]).then((result) => {
        if (result.processedAnyPage) usersProcessed++
        else skipped++
      })
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
