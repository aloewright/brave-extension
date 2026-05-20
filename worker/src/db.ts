import type { Env } from "./env"

// ── Row shapes ─────────────────────────────────────────────────────────────
export interface ConversationRow {
  id: string
  backend: string
  title: string
  content_text: string
  message_count: number
  chunk_count: number
  started_at: number
  updated_at: number
}

export interface LinkRow {
  id: string
  url: string
  title: string
  description: string | null
  tags: string                 // JSON array stored as TEXT
  favicon: string | null
  source: string
  chunk_count: number
  created_at: number
  updated_at: number
}

// ── Conversation queries ───────────────────────────────────────────────────
export async function insertConversation(env: Env, row: ConversationRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO conversations
       (id, backend, title, content_text, message_count, chunk_count, started_at, updated_at)
     VALUES (?,  ?,       ?,     ?,            ?,             ?,           ?,          ?)`
  )
    .bind(
      row.id, row.backend, row.title, row.content_text,
      row.message_count, row.chunk_count, row.started_at, row.updated_at
    )
    .run()
}

export async function getConversation(env: Env, id: string): Promise<ConversationRow | null> {
  return (await env.DB.prepare("SELECT * FROM conversations WHERE id = ?").bind(id).first<ConversationRow>()) ?? null
}

export async function listConversations(
  env: Env,
  opts: { backend?: string; limit?: number; before?: number } = {}
): Promise<ConversationRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.backend) {
    where.push("backend = ?")
    binds.push(opts.backend)
  }
  if (opts.before) {
    where.push("updated_at < ?")
    binds.push(opts.before)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM conversations ${whereSql} ORDER BY updated_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<ConversationRow>()
  return results ?? []
}

export async function updateConversation(
  env: Env,
  id: string,
  patch: { title?: string; content_text?: string; message_count?: number; chunk_count?: number; updated_at: number }
): Promise<void> {
  const sets: string[] = []
  const binds: (string | number)[] = []
  if (patch.title !== undefined) { sets.push("title = ?"); binds.push(patch.title) }
  if (patch.content_text !== undefined) { sets.push("content_text = ?"); binds.push(patch.content_text) }
  if (patch.message_count !== undefined) { sets.push("message_count = ?"); binds.push(patch.message_count) }
  if (patch.chunk_count !== undefined) { sets.push("chunk_count = ?"); binds.push(patch.chunk_count) }
  sets.push("updated_at = ?"); binds.push(patch.updated_at)
  binds.push(id)
  await env.DB.prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run()
}

export async function deleteConversation(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM conversations WHERE id = ?").bind(id).run()
}

// ── Link queries ───────────────────────────────────────────────────────────
export async function upsertLink(env: Env, row: LinkRow): Promise<{ id: string; created: boolean }> {
  const existing = await env.DB.prepare("SELECT id FROM links WHERE url = ?").bind(row.url).first<{ id: string }>()
  if (existing) {
    await env.DB.prepare(
      `UPDATE links SET
         title = ?, description = ?, tags = ?, favicon = ?, source = ?,
         chunk_count = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(row.title, row.description, row.tags, row.favicon, row.source, row.chunk_count, row.updated_at, existing.id)
      .run()
    return { id: existing.id, created: false }
  }
  await env.DB.prepare(
    `INSERT INTO links
       (id, url, title, description, tags, favicon, source, chunk_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.url, row.title, row.description, row.tags, row.favicon, row.source,
      row.chunk_count, row.created_at, row.updated_at
    )
    .run()
  return { id: row.id, created: true }
}

export async function getLink(env: Env, id: string): Promise<LinkRow | null> {
  return (await env.DB.prepare("SELECT * FROM links WHERE id = ?").bind(id).first<LinkRow>()) ?? null
}

export async function listLinks(
  env: Env,
  opts: { tag?: string; limit?: number; before?: number } = {}
): Promise<LinkRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.before) {
    where.push("created_at < ?")
    binds.push(opts.before)
  }
  if (opts.tag) {
    where.push("tags LIKE ?")
    binds.push(`%"${opts.tag}"%`)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM links ${whereSql} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<LinkRow>()
  return results ?? []
}

export async function deleteLink(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM links WHERE id = ?").bind(id).run()
}

// ── Bookmark queries ───────────────────────────────────────────────────────
export interface BookmarkRow {
  id: string
  url: string
  title: string
  parent_id: string | null
  path: string                 // JSON array stored as TEXT
  category: string
  is_favorite: number          // 0 | 1
  date_added: number | null
  position: number | null
  chunk_count: number
  synced_at: number
}

export async function getBookmark(env: Env, id: string): Promise<BookmarkRow | null> {
  return (await env.DB.prepare("SELECT * FROM bookmarks WHERE id = ?").bind(id).first<BookmarkRow>()) ?? null
}

export async function listBookmarks(
  env: Env,
  opts: { category?: string; favorite?: boolean; limit?: number } = {}
): Promise<BookmarkRow[]> {
  const limit = Math.min(opts.limit ?? 500, 2000)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.category) {
    where.push("category = ?")
    binds.push(opts.category)
  }
  if (opts.favorite !== undefined) {
    where.push("is_favorite = ?")
    binds.push(opts.favorite ? 1 : 0)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM bookmarks ${whereSql} ORDER BY category, position LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<BookmarkRow>()
  return results ?? []
}

export async function insertBookmark(env: Env, row: BookmarkRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO bookmarks
       (id, url, title, parent_id, path, category, is_favorite,
        date_added, position, chunk_count, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.url, row.title, row.parent_id, row.path, row.category,
      row.is_favorite, row.date_added, row.position, row.chunk_count, row.synced_at
    )
    .run()
}

export async function updateBookmark(env: Env, row: BookmarkRow): Promise<void> {
  await env.DB.prepare(
    `UPDATE bookmarks SET
       url = ?, title = ?, parent_id = ?, path = ?, category = ?,
       is_favorite = ?, date_added = ?, position = ?, chunk_count = ?, synced_at = ?
     WHERE id = ?`
  )
    .bind(
      row.url, row.title, row.parent_id, row.path, row.category,
      row.is_favorite, row.date_added, row.position, row.chunk_count, row.synced_at,
      row.id
    )
    .run()
}

export async function deleteBookmark(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM bookmarks WHERE id = ?").bind(id).run()
}

/** Used by snapshot diff — returns just the columns we need to detect changes. */
export async function listAllBookmarksDiffShape(
  env: Env
): Promise<{ id: string; url: string; title: string; category: string; chunk_count: number }[]> {
  const { results } = await env.DB
    .prepare("SELECT id, url, title, category, chunk_count FROM bookmarks")
    .all<{ id: string; url: string; title: string; category: string; chunk_count: number }>()
  return results ?? []
}
