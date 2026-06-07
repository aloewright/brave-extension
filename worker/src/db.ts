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

// ── Recording queries ──────────────────────────────────────────────────────
export type RecordingStatus = "pending" | "transcribing" | "embedding" | "ready" | "failed"

export interface RecordingRow {
  id: string
  filename: string
  mime_type: string
  duration_ms: number
  size_bytes: number
  source: string                // 'tab'|'screen'|'camera'
  origin_url: string | null
  r2_key: string
  transcript: string | null
  status: RecordingStatus
  status_message: string | null
  workflow_id: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

export async function insertRecording(env: Env, row: RecordingRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO recordings
       (id, filename, mime_type, duration_ms, size_bytes, source, origin_url,
        r2_key, transcript, status, status_message, workflow_id, chunk_count,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.filename, row.mime_type, row.duration_ms, row.size_bytes,
      row.source, row.origin_url, row.r2_key, row.transcript, row.status,
      row.status_message, row.workflow_id, row.chunk_count,
      row.created_at, row.updated_at
    )
    .run()
}

export async function getRecording(env: Env, id: string): Promise<RecordingRow | null> {
  return (await env.DB.prepare("SELECT * FROM recordings WHERE id = ?").bind(id).first<RecordingRow>()) ?? null
}

export async function listRecordings(
  env: Env,
  opts: { status?: RecordingStatus; limit?: number; before?: number } = {}
): Promise<RecordingRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.status) {
    where.push("status = ?")
    binds.push(opts.status)
  }
  if (opts.before) {
    where.push("created_at < ?")
    binds.push(opts.before)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM recordings ${whereSql} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<RecordingRow>()
  return results ?? []
}

export async function updateRecording(
  env: Env,
  id: string,
  patch: {
    transcript?: string | null
    status?: RecordingStatus
    status_message?: string | null
    workflow_id?: string | null
    chunk_count?: number
    updated_at: number
  }
): Promise<void> {
  const sets: string[] = []
  const binds: (string | number | null)[] = []
  if (patch.transcript !== undefined) { sets.push("transcript = ?"); binds.push(patch.transcript) }
  if (patch.status !== undefined) { sets.push("status = ?"); binds.push(patch.status) }
  if (patch.status_message !== undefined) { sets.push("status_message = ?"); binds.push(patch.status_message) }
  if (patch.workflow_id !== undefined) { sets.push("workflow_id = ?"); binds.push(patch.workflow_id) }
  if (patch.chunk_count !== undefined) { sets.push("chunk_count = ?"); binds.push(patch.chunk_count) }
  sets.push("updated_at = ?"); binds.push(patch.updated_at)
  binds.push(id)
  await env.DB.prepare(`UPDATE recordings SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run()
}

export async function deleteRecording(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM recordings WHERE id = ?").bind(id).run()
}

// ── PDF queries ────────────────────────────────────────────────────────────
export type PdfStatus = "pending" | "extracting" | "embedding" | "ready" | "failed"

export interface PdfRow {
  id: string
  filename: string
  title: string | null
  source_url: string | null
  size_bytes: number
  page_count: number | null
  r2_key: string
  text_content: string | null
  status: PdfStatus
  status_message: string | null
  workflow_id: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

export async function insertPdf(env: Env, row: PdfRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pdfs
       (id, filename, title, source_url, size_bytes, page_count, r2_key,
        text_content, status, status_message, workflow_id, chunk_count,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.filename, row.title, row.source_url, row.size_bytes,
      row.page_count, row.r2_key, row.text_content, row.status,
      row.status_message, row.workflow_id, row.chunk_count,
      row.created_at, row.updated_at
    )
    .run()
}

export async function getPdf(env: Env, id: string): Promise<PdfRow | null> {
  return (await env.DB.prepare("SELECT * FROM pdfs WHERE id = ?").bind(id).first<PdfRow>()) ?? null
}

export async function listPdfs(
  env: Env,
  opts: { status?: PdfStatus; limit?: number; before?: number } = {}
): Promise<PdfRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.status) {
    where.push("status = ?")
    binds.push(opts.status)
  }
  if (opts.before) {
    where.push("created_at < ?")
    binds.push(opts.before)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM pdfs ${whereSql} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<PdfRow>()
  return results ?? []
}

export async function updatePdf(
  env: Env,
  id: string,
  patch: {
    text_content?: string | null
    page_count?: number | null
    status?: PdfStatus
    status_message?: string | null
    workflow_id?: string | null
    chunk_count?: number
    updated_at: number
  }
): Promise<void> {
  const sets: string[] = []
  const binds: (string | number | null)[] = []
  if (patch.text_content !== undefined) { sets.push("text_content = ?"); binds.push(patch.text_content) }
  if (patch.page_count !== undefined) { sets.push("page_count = ?"); binds.push(patch.page_count) }
  if (patch.status !== undefined) { sets.push("status = ?"); binds.push(patch.status) }
  if (patch.status_message !== undefined) { sets.push("status_message = ?"); binds.push(patch.status_message) }
  if (patch.workflow_id !== undefined) { sets.push("workflow_id = ?"); binds.push(patch.workflow_id) }
  if (patch.chunk_count !== undefined) { sets.push("chunk_count = ?"); binds.push(patch.chunk_count) }
  sets.push("updated_at = ?"); binds.push(patch.updated_at)
  binds.push(id)
  await env.DB.prepare(`UPDATE pdfs SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run()
}

export async function deletePdf(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM pdfs WHERE id = ?").bind(id).run()
}

// ── Capture queries (ALO-468) ──────────────────────────────────────────────
export type CaptureKind = "screenshot" | "pdf"
export type CaptureStatus = "pending" | "ready" | "failed"

export interface CaptureRow {
  id: string
  kind: CaptureKind
  filename: string
  source_url: string | null
  source_title: string | null
  mime_type: string
  size_bytes: number
  r2_key: string
  extracted_text: string | null
  status: CaptureStatus
  status_message: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

export async function insertCapture(env: Env, row: CaptureRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO captures
       (id, kind, filename, source_url, source_title, mime_type, size_bytes,
        r2_key, extracted_text, status, status_message, chunk_count,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.kind, row.filename, row.source_url, row.source_title,
      row.mime_type, row.size_bytes, row.r2_key, row.extracted_text,
      row.status, row.status_message, row.chunk_count,
      row.created_at, row.updated_at
    )
    .run()
}

export async function getCapture(env: Env, id: string): Promise<CaptureRow | null> {
  return (await env.DB.prepare("SELECT * FROM captures WHERE id = ?").bind(id).first<CaptureRow>()) ?? null
}

export async function listCaptures(
  env: Env,
  opts: { kind?: CaptureKind; status?: CaptureStatus; limit?: number; before?: number } = {}
): Promise<CaptureRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.kind) {
    where.push("kind = ?")
    binds.push(opts.kind)
  }
  if (opts.status) {
    where.push("status = ?")
    binds.push(opts.status)
  }
  if (opts.before) {
    where.push("created_at < ?")
    binds.push(opts.before)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM captures ${whereSql} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<CaptureRow>()
  return results ?? []
}

export async function updateCapture(
  env: Env,
  id: string,
  patch: {
    extracted_text?: string | null
    status?: CaptureStatus
    status_message?: string | null
    chunk_count?: number
    updated_at: number
  }
): Promise<void> {
  const sets: string[] = []
  const binds: (string | number | null)[] = []
  if (patch.extracted_text !== undefined) { sets.push("extracted_text = ?"); binds.push(patch.extracted_text) }
  if (patch.status !== undefined) { sets.push("status = ?"); binds.push(patch.status) }
  if (patch.status_message !== undefined) { sets.push("status_message = ?"); binds.push(patch.status_message) }
  if (patch.chunk_count !== undefined) { sets.push("chunk_count = ?"); binds.push(patch.chunk_count) }
  sets.push("updated_at = ?"); binds.push(patch.updated_at)
  binds.push(id)
  await env.DB.prepare(`UPDATE captures SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run()
}

export async function deleteCapture(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM captures WHERE id = ?").bind(id).run()
}

// ── Highlight queries ──────────────────────────────────────────────────────
export interface HighlightRow {
  id: string
  text: string
  note: string | null
  tags: string
  source_url: string | null
  source_title: string | null
  source_host: string | null
  source_favicon: string | null
  context_before: string | null
  context_after: string | null
  source: string
  chunk_count: number
  created_at: number
  updated_at: number
}

export async function upsertHighlight(
  env: Env,
  row: HighlightRow
): Promise<{ id: string; created: boolean; previousChunkCount: number }> {
  const existing = await env.DB.prepare("SELECT id, chunk_count, created_at FROM highlights WHERE id = ?")
    .bind(row.id)
    .first<{ id: string; chunk_count: number; created_at: number }>()

  if (existing) {
    await env.DB.prepare(
      `UPDATE highlights SET
         text = ?, note = ?, tags = ?, source_url = ?, source_title = ?,
         source_host = ?, source_favicon = ?, context_before = ?,
         context_after = ?, source = ?, chunk_count = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(
        row.text, row.note, row.tags, row.source_url, row.source_title,
        row.source_host, row.source_favicon, row.context_before,
        row.context_after, row.source, row.chunk_count, row.updated_at, row.id
      )
      .run()
    return { id: existing.id, created: false, previousChunkCount: existing.chunk_count }
  }

  await env.DB.prepare(
    `INSERT INTO highlights
       (id, text, note, tags, source_url, source_title, source_host,
        source_favicon, context_before, context_after, source, chunk_count,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id, row.text, row.note, row.tags, row.source_url, row.source_title,
      row.source_host, row.source_favicon, row.context_before,
      row.context_after, row.source, row.chunk_count, row.created_at, row.updated_at
    )
    .run()
  return { id: row.id, created: true, previousChunkCount: 0 }
}

export async function getHighlight(env: Env, id: string): Promise<HighlightRow | null> {
  return (await env.DB.prepare("SELECT * FROM highlights WHERE id = ?").bind(id).first<HighlightRow>()) ?? null
}

export async function listHighlights(
  env: Env,
  opts: { host?: string; limit?: number; before?: number } = {}
): Promise<HighlightRow[]> {
  const limit = Math.min(opts.limit ?? 50, 200)
  const where: string[] = []
  const binds: (string | number)[] = []
  if (opts.host) {
    where.push("source_host = ?")
    binds.push(opts.host)
  }
  if (opts.before) {
    where.push("created_at < ?")
    binds.push(opts.before)
  }
  const whereSql = where.length ? "WHERE " + where.join(" AND ") : ""
  const stmt = env.DB.prepare(
    `SELECT * FROM highlights ${whereSql} ORDER BY created_at DESC LIMIT ?`
  ).bind(...binds, limit)
  const { results } = await stmt.all<HighlightRow>()
  return results ?? []
}

export async function updateHighlight(
  env: Env,
  id: string,
  patch: {
    text?: string
    note?: string | null
    tags?: string
    source_url?: string | null
    source_title?: string | null
    source_host?: string | null
    source_favicon?: string | null
    context_before?: string | null
    context_after?: string | null
    source?: string
    chunk_count?: number
    updated_at: number
  }
): Promise<void> {
  const sets: string[] = []
  const binds: (string | number | null)[] = []
  if (patch.text !== undefined) { sets.push("text = ?"); binds.push(patch.text) }
  if (patch.note !== undefined) { sets.push("note = ?"); binds.push(patch.note) }
  if (patch.tags !== undefined) { sets.push("tags = ?"); binds.push(patch.tags) }
  if (patch.source_url !== undefined) { sets.push("source_url = ?"); binds.push(patch.source_url) }
  if (patch.source_title !== undefined) { sets.push("source_title = ?"); binds.push(patch.source_title) }
  if (patch.source_host !== undefined) { sets.push("source_host = ?"); binds.push(patch.source_host) }
  if (patch.source_favicon !== undefined) { sets.push("source_favicon = ?"); binds.push(patch.source_favicon) }
  if (patch.context_before !== undefined) { sets.push("context_before = ?"); binds.push(patch.context_before) }
  if (patch.context_after !== undefined) { sets.push("context_after = ?"); binds.push(patch.context_after) }
  if (patch.source !== undefined) { sets.push("source = ?"); binds.push(patch.source) }
  if (patch.chunk_count !== undefined) { sets.push("chunk_count = ?"); binds.push(patch.chunk_count) }
  sets.push("updated_at = ?"); binds.push(patch.updated_at)
  binds.push(id)
  await env.DB.prepare(`UPDATE highlights SET ${sets.join(", ")} WHERE id = ?`).bind(...binds).run()
}

export async function deleteHighlight(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM highlights WHERE id = ?").bind(id).run()
}
