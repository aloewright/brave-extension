import { Hono } from "hono"
import type { Env } from "../env"
import { ulid } from "../ulid"
import { deleteFor, upsertFor } from "../vectors"

const scrapes = new Hono<{ Bindings: Env }>()

const MAX_HTML_CHARS = 100_000
const MAX_TEXT_CHARS = 30_000
const MAX_LINKS = 200
const MAX_IMAGES = 100
const MAX_FETCH_BYTES = 1_500_000
const MAX_DUE_JOBS_PER_TICK = 10

type ScrapeSource = "extension" | "server" | "manual" | "cron"
type ScrapeStatus = "ready" | "failed"
type ScheduleType = "manual" | "interval" | "cron"

interface ScrapeLink {
  href: string
  text: string
}

interface ScrapeImage {
  src: string
  alt: string
}

interface ScrapePayload {
  url?: string
  title?: string
  text?: string
  html?: string
  links?: ScrapeLink[]
  images?: ScrapeImage[]
  meta?: Record<string, string>
  timestamp?: number
  source?: ScrapeSource
}

interface ScrapeRunRow {
  id: string
  job_id: string | null
  source: ScrapeSource
  url: string
  final_url: string | null
  title: string
  text: string
  html: string
  links: string
  images: string
  meta: string
  status: ScrapeStatus
  status_message: string | null
  content_type: string | null
  size_bytes: number
  duration_ms: number
  chunk_count: number
  created_at: number
  updated_at: number
}

interface ScrapeJobRow {
  id: string
  url: string
  title: string
  enabled: number
  schedule_type: ScheduleType
  interval_minutes: number | null
  cron_expr: string | null
  last_run_id: string | null
  last_run_at: number | null
  next_run_at: number | null
  last_status: ScrapeStatus | null
  last_error: string | null
  created_at: number
  updated_at: number
}

scrapes.post("/", async (c) => {
  const body = await c.req.json<ScrapePayload>().catch(() => null)
  if (!body?.url) {
    return c.json({ error: { code: "bad_request", message: "url required" } }, 400)
  }

  let input: ScrapePayload
  if (typeof body.text === "string" || typeof body.html === "string") {
    input = body
  } else {
    input = await fetchAndExtract(body.url, body.source ?? "server")
  }

  const run = await persistScrapeRun(c.env, {
    ...input,
    source: body.source ?? input.source ?? "extension"
  })
  return c.json({ scrape: serializeRun(run) }, 201)
})

scrapes.post("/run", async (c) => {
  const body = await c.req.json<{ url?: string; crawl?: boolean }>().catch(() => null)
  if (!body?.url) {
    return c.json({ error: { code: "bad_request", message: "url required" } }, 400)
  }
  if (body.crawl) {
    const runs = await crawlAndPersist(c.env, body.url)
    const ready = runs.some((run) => run.status === "ready")
    return c.json({ scrape: serializeRun(runs[0]!), scrapes: runs.map(serializeRun) }, ready ? 201 : 502)
  }
  const result = await fetchAndExtract(body.url, "server")
  const run = await persistScrapeRun(c.env, result)
  return c.json({ scrape: serializeRun(run) }, run.status === "ready" ? 201 : 502)
})

scrapes.get("/runs", async (c) => {
  const limit = clampLimit(c.req.query("limit"), 50, 200)
  const jobId = c.req.query("jobId")
  const before = parseNumber(c.req.query("before"))
  const where: string[] = []
  const binds: (string | number)[] = []
  if (jobId) {
    where.push("job_id = ?")
    binds.push(jobId)
  }
  if (before) {
    where.push("created_at < ?")
    binds.push(before)
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM scrape_runs ${whereSql} ORDER BY created_at DESC LIMIT ?`
  )
    .bind(...binds, limit)
    .all<ScrapeRunRow>()
  return c.json({ scrapes: (results ?? []).map(serializeRun) })
})

scrapes.get("/runs/:id", async (c) => {
  const row = await getRun(c.env, c.req.param("id"))
  if (!row) return c.json({ error: { code: "not_found", message: "no such scrape run" } }, 404)
  return c.json({ scrape: serializeRun(row) })
})

scrapes.delete("/runs/:id", async (c) => {
  const id = c.req.param("id")
  const row = await getRun(c.env, id)
  if (!row) return c.body(null, 204)
  await deleteFor(c.env, "scrape", id, row.chunk_count)
  await c.env.DB.prepare("DELETE FROM scrape_runs WHERE id = ?").bind(id).run()
  return c.body(null, 204)
})

scrapes.post("/jobs", async (c) => {
  const body = await c.req.json<{
    url?: string
    title?: string
    enabled?: boolean
    scheduleType?: ScheduleType
    intervalMinutes?: number
    cron?: string
  }>().catch(() => null)
  if (!body?.url || !isHttpUrl(body.url)) {
    return c.json({ error: { code: "bad_request", message: "valid http(s) url required" } }, 400)
  }

  const schedule = normalizeSchedule(body)
  if ("error" in schedule) {
    return c.json({ error: { code: "bad_request", message: schedule.error } }, 400)
  }

  const now = Date.now()
  const id = ulid()
  const nextRunAt = computeNextRun(schedule.scheduleType, {
    intervalMinutes: schedule.intervalMinutes,
    cronExpr: schedule.cronExpr,
    from: now
  })
  const row: ScrapeJobRow = {
    id,
    url: body.url,
    title: body.title?.trim() || "",
    enabled: body.enabled === false ? 0 : 1,
    schedule_type: schedule.scheduleType,
    interval_minutes: schedule.intervalMinutes,
    cron_expr: schedule.cronExpr,
    last_run_id: null,
    last_run_at: null,
    next_run_at: body.enabled === false ? null : nextRunAt,
    last_status: null,
    last_error: null,
    created_at: now,
    updated_at: now
  }
  await insertJob(c.env, row)
  return c.json({ job: serializeJob(row) }, 201)
})

scrapes.get("/jobs", async (c) => {
  const limit = clampLimit(c.req.query("limit"), 50, 200)
  const query = (c.req.query("q") ?? "").trim()
  const where = query ? "WHERE title LIKE ? OR url LIKE ? OR schedule_type LIKE ? OR last_status LIKE ?" : ""
  const binds = query ? Array(4).fill(`%${query}%`) : []
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM scrape_jobs ${where} ORDER BY created_at DESC LIMIT ?`
  )
    .bind(...binds, limit)
    .all<ScrapeJobRow>()
  return c.json({ jobs: (results ?? []).map(serializeJob) })
})

scrapes.post("/jobs/:id/run", async (c) => {
  const job = await getJob(c.env, c.req.param("id"))
  if (!job) return c.json({ error: { code: "not_found", message: "no such scrape job" } }, 404)
  const run = await runScrapeJob(c.env, job, "manual", Date.now())
  return c.json({ job: serializeJob((await getJob(c.env, job.id)) ?? job), scrape: serializeRun(run) })
})

scrapes.delete("/jobs/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM scrape_jobs WHERE id = ?").bind(c.req.param("id")).run()
  return c.body(null, 204)
})

export async function runDueScrapeJobs(env: Env, now = Date.now()): Promise<{ ran: number }> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM scrape_jobs
     WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
     ORDER BY next_run_at ASC LIMIT ?`
  )
    .bind(now, MAX_DUE_JOBS_PER_TICK)
    .all<ScrapeJobRow>()

  let ran = 0
  for (const job of results ?? []) {
    await runScrapeJob(env, job, "cron", now)
    ran += 1
  }
  return { ran }
}

async function runScrapeJob(env: Env, job: ScrapeJobRow, source: ScrapeSource, now: number): Promise<ScrapeRunRow> {
  const fetched = await fetchAndExtract(job.url, source)
  const run = await persistScrapeRun(env, { ...fetched, source }, job.id)
  const nextRunAt = computeNextRun(job.schedule_type, {
    intervalMinutes: job.interval_minutes,
    cronExpr: job.cron_expr,
    from: now + 1
  })
  await env.DB.prepare(
    `UPDATE scrape_jobs SET
       last_run_id = ?, last_run_at = ?, next_run_at = ?, last_status = ?,
       last_error = ?, updated_at = ?
     WHERE id = ?`
  )
    .bind(
      run.id,
      now,
      job.enabled ? nextRunAt : null,
      run.status,
      run.status === "failed" ? run.status_message : null,
      Date.now(),
      job.id
    )
    .run()
  return run
}

async function crawlAndPersist(env: Env, startUrl: string): Promise<ScrapeRunRow[]> {
  if (!isHttpUrl(startUrl)) {
    return [await persistScrapeRun(env, failedPayload(startUrl, "server", "only http(s) URLs can be crawled", Date.now()))]
  }
  const queue = [canonicalScrapeUrl(startUrl)]
  const seen = new Set<string>()
  const runs: ScrapeRunRow[] = []
  while (queue.length > 0) {
    const next = queue.shift()!
    if (seen.has(next)) continue
    seen.add(next)
    const fetched = await fetchAndExtract(next, "server")
    const run = await persistScrapeRun(env, fetched)
    runs.push(run)
    if (run.status !== "ready") continue
    for (const link of safeJson<ScrapeLink[]>(run.links, [])) {
      const candidate = canonicalScrapeUrl(link.href)
      if (!candidate || seen.has(candidate) || queue.includes(candidate)) continue
      if (isSubpageUrl(candidate, startUrl)) queue.push(candidate)
    }
  }
  return runs.length > 0 ? runs : [await persistScrapeRun(env, failedPayload(startUrl, "server", "no crawlable pages found", Date.now()))]
}

async function fetchAndExtract(url: string, source: ScrapeSource): Promise<ScrapePayload & {
  source: ScrapeSource
  finalUrl?: string
  status?: ScrapeStatus
  statusMessage?: string | null
  contentType?: string | null
  sizeBytes?: number
  durationMs?: number
}> {
  const started = Date.now()
  if (!isHttpUrl(url)) {
    return failedPayload(url, source, "only http(s) URLs can be scraped", started)
  }
  try {
    const res = await fetch(url, {
      headers: {
        "accept": "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
        "user-agent": "AI Dev Sidebar Scraper/0.1 (+https://txt.fly.pm)"
      },
      redirect: "follow"
    })
    const contentType = res.headers.get("content-type")
    if (!res.ok) {
      return failedPayload(url, source, `fetch returned ${res.status}`, started, {
        finalUrl: res.url,
        contentType
      })
    }
    if (contentType && !/text\/html|application\/xhtml\+xml|text\/plain/i.test(contentType)) {
      return failedPayload(url, source, `unsupported content-type ${contentType}`, started, {
        finalUrl: res.url,
        contentType
      })
    }
    const { text: html, bytes } = await readTextCapped(res, MAX_FETCH_BYTES)
    const extracted = extractHtml(html, res.url || url)
    return {
      ...extracted,
      url,
      source,
      finalUrl: res.url || url,
      status: "ready",
      statusMessage: null,
      contentType,
      sizeBytes: bytes,
      durationMs: Date.now() - started,
      timestamp: Date.now()
    }
  } catch (err) {
    return failedPayload(url, source, err instanceof Error ? err.message : String(err), started)
  }
}

async function readTextCapped(res: Response, maxBytes: number): Promise<{ text: string; bytes: number }> {
  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    const bytes = new TextEncoder().encode(text).byteLength
    return { text: text.slice(0, MAX_HTML_CHARS), bytes }
  }
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue
    total += value.byteLength
    if (total > maxBytes) throw new Error(`response exceeds ${maxBytes} bytes`)
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { text: new TextDecoder().decode(out), bytes: total }
}

function extractHtml(html: string, baseUrl: string): Pick<ScrapePayload, "title" | "text" | "html" | "links" | "images" | "meta"> {
  const title = decodeEntities(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)).trim()
  const meta = extractMeta(html)
  const body = firstMatch(html, /<body[^>]*>([\s\S]*?)<\/body>/i) || html
  const readable = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, " ")
  return {
    title: title || meta["og:title"] || meta.description || baseUrl,
    text: htmlToText(readable).slice(0, MAX_TEXT_CHARS),
    html: html.slice(0, MAX_HTML_CHARS),
    links: extractLinks(html, baseUrl),
    images: extractImages(html, baseUrl),
    meta
  }
}

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim()
}

function extractMeta(html: string): Record<string, string> {
  const meta: Record<string, string> = {}
  for (const tag of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttrs(tag[0])
    const key = attrs.name || attrs.property
    const value = attrs.content
    if (key && value) meta[key] = decodeEntities(value).slice(0, 1000)
  }
  return meta
}

function extractLinks(html: string, baseUrl: string): ScrapeLink[] {
  const links: ScrapeLink[] = []
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttrs(match[1] ?? "")
    if (!attrs.href) continue
    const href = absoluteUrl(attrs.href, baseUrl)
    if (!href) continue
    links.push({ href, text: htmlToText(match[2] ?? "").slice(0, 120) })
    if (links.length >= MAX_LINKS) break
  }
  return links
}

function extractImages(html: string, baseUrl: string): ScrapeImage[] {
  const images: ScrapeImage[] = []
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1] ?? "")
    const src = attrs.src ? absoluteUrl(attrs.src, baseUrl) : null
    if (!src) continue
    images.push({ src, alt: decodeEntities(attrs.alt ?? "").slice(0, 200) })
    if (images.length >= MAX_IMAGES) break
  }
  return images
}

function parseAttrs(input: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const match of input.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[match[1]!.toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? ""
  }
  return attrs
}

async function persistScrapeRun(env: Env, input: ScrapePayload & {
  finalUrl?: string
  status?: ScrapeStatus
  statusMessage?: string | null
  contentType?: string | null
  sizeBytes?: number
  durationMs?: number
}, jobId: string | null = null): Promise<ScrapeRunRow> {
  const now = input.timestamp && Number.isFinite(input.timestamp) ? input.timestamp : Date.now()
  const row: ScrapeRunRow = {
    id: ulid(),
    job_id: jobId,
    source: input.source ?? "extension",
    url: input.url ?? "",
    final_url: input.finalUrl ?? null,
    title: (input.title ?? "").slice(0, 500),
    text: (input.text ?? "").slice(0, MAX_TEXT_CHARS),
    html: (input.html ?? "").slice(0, MAX_HTML_CHARS),
    links: JSON.stringify((input.links ?? []).slice(0, MAX_LINKS)),
    images: JSON.stringify((input.images ?? []).slice(0, MAX_IMAGES)),
    meta: JSON.stringify(input.meta ?? {}),
    status: input.status ?? "ready",
    status_message: input.statusMessage ?? null,
    content_type: input.contentType ?? null,
    size_bytes: input.sizeBytes ?? byteLength(input.html ?? input.text ?? ""),
    duration_ms: input.durationMs ?? 0,
    chunk_count: 0,
    created_at: now,
    updated_at: Date.now()
  }

  const embedText = [row.title, row.url, row.text].filter(Boolean).join("\n")
  if (row.status === "ready" && embedText.trim()) {
    try {
      const { chunkCount } = await upsertFor(env, "scrape", row.id, embedText, {
        title: row.title || row.url,
        createdAt: row.created_at
      })
      row.chunk_count = chunkCount
    } catch (err) {
      row.status = "failed"
      row.status_message = `embedding failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  await env.DB.prepare(
    `INSERT INTO scrape_runs
       (id, job_id, source, url, final_url, title, text, html, links, images,
        meta, status, status_message, content_type, size_bytes, duration_ms,
        chunk_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.job_id,
      row.source,
      row.url,
      row.final_url,
      row.title,
      row.text,
      row.html,
      row.links,
      row.images,
      row.meta,
      row.status,
      row.status_message,
      row.content_type,
      row.size_bytes,
      row.duration_ms,
      row.chunk_count,
      row.created_at,
      row.updated_at
    )
    .run()
  return row
}

function serializeRun(row: ScrapeRunRow) {
  return {
    id: row.id,
    jobId: row.job_id,
    source: row.source,
    url: row.url,
    finalUrl: row.final_url,
    title: row.title,
    text: row.text,
    html: row.html,
    links: safeJson<ScrapeLink[]>(row.links, []),
    images: safeJson<ScrapeImage[]>(row.images, []),
    meta: safeJson<Record<string, string>>(row.meta, {}),
    status: row.status,
    statusMessage: row.status_message,
    contentType: row.content_type,
    sizeBytes: row.size_bytes,
    durationMs: row.duration_ms,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function serializeJob(row: ScrapeJobRow) {
  return {
    id: row.id,
    url: row.url,
    title: row.title,
    enabled: row.enabled === 1,
    scheduleType: row.schedule_type,
    intervalMinutes: row.interval_minutes,
    cron: row.cron_expr,
    lastRunId: row.last_run_id,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastStatus: row.last_status,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

async function getRun(env: Env, id: string): Promise<ScrapeRunRow | null> {
  return (await env.DB.prepare("SELECT * FROM scrape_runs WHERE id = ?").bind(id).first<ScrapeRunRow>()) ?? null
}

async function getJob(env: Env, id: string): Promise<ScrapeJobRow | null> {
  return (await env.DB.prepare("SELECT * FROM scrape_jobs WHERE id = ?").bind(id).first<ScrapeJobRow>()) ?? null
}

async function insertJob(env: Env, row: ScrapeJobRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO scrape_jobs
       (id, url, title, enabled, schedule_type, interval_minutes, cron_expr,
        last_run_id, last_run_at, next_run_at, last_status, last_error,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      row.id,
      row.url,
      row.title,
      row.enabled,
      row.schedule_type,
      row.interval_minutes,
      row.cron_expr,
      row.last_run_id,
      row.last_run_at,
      row.next_run_at,
      row.last_status,
      row.last_error,
      row.created_at,
      row.updated_at
    )
    .run()
}

function normalizeSchedule(body: {
  scheduleType?: ScheduleType
  intervalMinutes?: number
  cron?: string
}): { scheduleType: ScheduleType; intervalMinutes: number | null; cronExpr: string | null } | { error: string } {
  const scheduleType = body.scheduleType ?? (body.cron ? "cron" : body.intervalMinutes ? "interval" : "manual")
  if (!["manual", "interval", "cron"].includes(scheduleType)) return { error: "invalid scheduleType" }
  if (scheduleType === "manual") return { scheduleType, intervalMinutes: null, cronExpr: null }
  if (scheduleType === "interval") {
    const intervalMinutes = Math.floor(Number(body.intervalMinutes ?? 0))
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 5 || intervalMinutes > 60 * 24 * 30) {
      return { error: "intervalMinutes must be between 5 and 43200" }
    }
    return { scheduleType, intervalMinutes, cronExpr: null }
  }
  const cronExpr = (body.cron ?? "").trim()
  if (!nextCronTime(cronExpr, Date.now())) return { error: "unsupported cron expression" }
  return { scheduleType, intervalMinutes: null, cronExpr }
}

function computeNextRun(
  scheduleType: ScheduleType,
  opts: { intervalMinutes?: number | null; cronExpr?: string | null; from: number }
): number | null {
  if (scheduleType === "manual") return null
  if (scheduleType === "interval") return opts.from + Math.max(5, opts.intervalMinutes ?? 60) * 60_000
  return nextCronTime(opts.cronExpr ?? "", opts.from)
}

function nextCronTime(expr: string, from: number): number | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts
  const minutes = parseCronField(minuteExpr!, 0, 59)
  const hours = parseCronField(hourExpr!, 0, 23)
  const dom = parseCronField(domExpr!, 1, 31)
  const months = parseCronField(monthExpr!, 1, 12)
  const rawDow = parseCronField(dowExpr!, 0, 7)
  if (!minutes || !hours || !dom || !months || !rawDow) return null
  const dow = rawDow.map((v) => (v === 7 ? 0 : v))

  const candidate = new Date(from)
  candidate.setUTCSeconds(0, 0)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  const max = from + 366 * 24 * 60 * 60_000
  while (candidate.getTime() <= max) {
    if (
      minutes.includes(candidate.getUTCMinutes()) &&
      hours.includes(candidate.getUTCHours()) &&
      dom.includes(candidate.getUTCDate()) &&
      months.includes(candidate.getUTCMonth() + 1) &&
      dow.includes(candidate.getUTCDay())
    ) {
      return candidate.getTime()
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }
  return null
}

function parseCronField(expr: string, min: number, max: number): number[] | null {
  const values = new Set<number>()
  for (const part of expr.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) values.add(i)
      continue
    }
    const stepMatch = part.match(/^\*\/(\d+)$/)
    if (stepMatch) {
      const step = Number(stepMatch[1])
      if (!Number.isInteger(step) || step <= 0) return null
      for (let i = min; i <= max; i += step) values.add(i)
      continue
    }
    const rangeMatch = part.match(/^(\d+)-(\d+)$/)
    if (rangeMatch) {
      const start = Number(rangeMatch[1])
      const end = Number(rangeMatch[2])
      if (start > end || start < min || end > max) return null
      for (let i = start; i <= end; i++) values.add(i)
      continue
    }
    const n = Number(part)
    if (!Number.isInteger(n) || n < min || n > max) return null
    values.add(n)
  }
  return [...values].sort((a, b) => a - b)
}

function failedPayload(
  url: string,
  source: ScrapeSource,
  message: string,
  started: number,
  extra: { finalUrl?: string; contentType?: string | null } = {}
) {
  return {
    url,
    title: "",
    text: "",
    html: "",
    links: [],
    images: [],
    meta: {},
    source,
    finalUrl: extra.finalUrl,
    status: "failed" as const,
    statusMessage: message,
    contentType: extra.contentType ?? null,
    sizeBytes: 0,
    durationMs: Date.now() - started,
    timestamp: Date.now()
  }
}

function absoluteUrl(value: string, baseUrl: string): string | null {
  try {
    const parsed = new URL(value, baseUrl)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null
  } catch {
    return null
  }
}

function canonicalScrapeUrl(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.hash = ""
    return parsed.href
  } catch {
    return value
  }
}

function isSubpageUrl(candidate: string, startUrl: string): boolean {
  try {
    const candidateUrl = new URL(candidate)
    const start = new URL(startUrl)
    if (candidateUrl.origin !== start.origin) return false
    return !looksLikeStaticAssetPath(candidateUrl.pathname)
  } catch {
    return false
  }
}

function looksLikeStaticAssetPath(pathname: string): boolean {
  return /\.(?:avif|bmp|css|csv|gif|ico|jpe?g|js|json|map|mp3|mp4|pdf|png|svg|webm|webp|woff2?|zip)$/i.test(pathname)
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function firstMatch(value: string, re: RegExp): string {
  return value.match(re)?.[1] ?? ""
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " }
  return value.replace(/&(#x?[0-9a-f]+|\w+);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const hex = entity[1]?.toLowerCase() === "x"
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ""
    }
    return named[entity.toLowerCase()] ?? `&${entity};`
  })
}

function safeJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function clampLimit(raw: string | undefined, fallback: number, max: number): number {
  const value = raw ? Number(raw) : fallback
  return Number.isFinite(value) ? Math.max(1, Math.min(max, Math.floor(value))) : fallback
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const value = Number(raw)
  return Number.isFinite(value) ? value : null
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export default scrapes
