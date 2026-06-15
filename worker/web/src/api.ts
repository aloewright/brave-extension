// ── Wire types (mirror what the Worker returns) ────────────────────────────
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
  tags: string                  // JSON-stringified array
  favicon: string | null
  source: string
  chunk_count: number
  created_at: number
  updated_at: number
}

export interface BookmarkRow {
  id: string
  url: string
  title: string
  parent_id: string | null
  path: string                  // JSON-stringified array
  category: string
  is_favorite: number
  date_added: number | null
  position: number | null
  chunk_count: number
  synced_at: number
}

export interface RecordingRow {
  id: string
  filename: string
  mime_type: string
  duration_ms: number
  size_bytes: number
  source: string
  origin_url: string | null
  r2_key: string
  transcript: string | null
  status: "pending" | "transcribing" | "embedding" | "ready" | "failed"
  status_message: string | null
  workflow_id: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

export interface PdfRow {
  id: string
  filename: string
  title: string | null
  source_url: string | null
  size_bytes: number
  page_count: number | null
  r2_key: string
  text_content: string | null
  status: "pending" | "extracting" | "embedding" | "ready" | "failed"
  status_message: string | null
  workflow_id: string | null
  chunk_count: number
  created_at: number
  updated_at: number
}

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

export interface HighlightWrite {
  text?: string
  note?: string | null
  tags?: string[]
  sourceUrl?: string | null
  sourceTitle?: string | null
  sourceFavicon?: string | null
  contextBefore?: string | null
  contextAfter?: string | null
  source?: string
  createdAt?: number
}

export type ResourceType = "conversation" | "link" | "bookmark" | "recording" | "pdf" | "capture" | "highlight" | "scrape"

export interface SearchHit {
  type: ResourceType
  id: string
  chunkIndex: number
  score: number
  title: string
  snippet: string
  createdAt: number
}

export interface ScrapeLink {
  href: string
  text: string
}

export interface ScrapeImage {
  src: string
  alt: string
}

export interface ScrapeRunRow {
  id: string
  jobId: string | null
  source: "extension" | "server" | "manual" | "cron" | string
  url: string
  finalUrl: string | null
  title: string
  text: string
  html: string
  links: ScrapeLink[]
  images: ScrapeImage[]
  meta: Record<string, string>
  status: "ready" | "failed"
  statusMessage: string | null
  contentType: string | null
  sizeBytes: number
  durationMs: number
  chunkCount: number
  createdAt: number
  updatedAt: number
}

export interface ScrapeJobRow {
  id: string
  url: string
  title: string
  enabled: boolean
  scheduleType: "manual" | "interval" | "cron"
  intervalMinutes: number | null
  cron: string | null
  lastRunId: string | null
  lastRunAt: number | null
  nextRunAt: number | null
  lastStatus: "ready" | "failed" | null
  lastError: string | null
  createdAt: number
  updatedAt: number
}

export interface ScrapeJobWrite {
  url: string
  title?: string
  enabled?: boolean
  scheduleType?: ScrapeJobRow["scheduleType"]
  intervalMinutes?: number
  cron?: string
}

// ── Error type ─────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

// ── Client ─────────────────────────────────────────────────────────────────
export interface ApiClient {
  health: () => Promise<{ ok: boolean; version: string; deployedAt: string }>
  search: (query: string, opts?: { types?: ResourceType[]; limit?: number }) => Promise<{ results: SearchHit[] }>
  conversations: {
    list: (opts?: { backend?: string; limit?: number }) => Promise<{ conversations: ConversationRow[] }>
    get: (id: string) => Promise<ConversationRow>
  }
  links: {
    list: (opts?: { tag?: string; limit?: number }) => Promise<{ links: LinkRow[] }>
    get: (id: string) => Promise<LinkRow>
  }
  bookmarks: {
    list: (opts?: { category?: string; favorite?: boolean }) => Promise<{ bookmarks: BookmarkRow[] }>
    get: (id: string) => Promise<BookmarkRow>
  }
  recordings: {
    list: (opts?: { status?: RecordingRow["status"]; limit?: number }) => Promise<{ recordings: RecordingRow[] }>
    get: (id: string) => Promise<RecordingRow>
    blobUrl: (id: string) => string
  }
  pdfs: {
    list: (opts?: { status?: PdfRow["status"]; limit?: number }) => Promise<{ pdfs: PdfRow[] }>
    get: (id: string) => Promise<PdfRow>
    blobUrl: (id: string) => string
  }
  highlights: {
    list: (opts?: { host?: string; limit?: number; before?: number }) => Promise<{ highlights: HighlightRow[] }>
    get: (id: string) => Promise<HighlightRow>
    create: (payload: HighlightWrite & { text: string }) => Promise<{ id: string; created: boolean; chunkCount: number }>
    update: (id: string, payload: HighlightWrite) => Promise<HighlightRow>
    delete: (id: string) => Promise<void>
  }
  scrapes: {
    listRuns: (opts?: { jobId?: string; limit?: number; before?: number }) => Promise<{ scrapes: ScrapeRunRow[] }>
    getRun: (id: string) => Promise<{ scrape: ScrapeRunRow }>
    deleteRun: (id: string) => Promise<void>
    runUrl: (url: string, opts?: { crawl?: boolean }) => Promise<{ scrape: ScrapeRunRow; scrapes?: ScrapeRunRow[] }>
    listJobs: (opts?: { q?: string; limit?: number }) => Promise<{ jobs: ScrapeJobRow[] }>
    createJob: (payload: ScrapeJobWrite) => Promise<{ job: ScrapeJobRow }>
    runJob: (id: string) => Promise<{ job: ScrapeJobRow; scrape: ScrapeRunRow }>
    deleteJob: (id: string) => Promise<void>
  }
}

export function createApiClient(token: string, baseUrl = ""): ApiClient {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (token) headers.set("x-sidebar-token", token)
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json")
    const res = await fetch(`${baseUrl}${path}`, { ...init, headers })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      const code = body?.error?.code ?? "http_error"
      const message = body?.error?.message ?? `request failed: ${res.status}`
      throw new ApiError(res.status, code, message)
    }
    if (res.status === 204) return undefined as T
    return (await res.json()) as T
  }

  function qs(params: Record<string, string | number | boolean | undefined>): string {
    const out = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&")
    return out ? `?${out}` : ""
  }

  return {
    health: () => request("/api/health"),
    search: (query, opts = {}) =>
      request("/api/search", {
        method: "POST",
        body: JSON.stringify({ query, types: opts.types, limit: opts.limit })
      }),
    conversations: {
      list: (opts = {}) => request(`/api/conversations${qs({ backend: opts.backend, limit: opts.limit })}`),
      get: (id) => request(`/api/conversations/${encodeURIComponent(id)}`)
    },
    links: {
      list: (opts = {}) => request(`/api/links${qs({ tag: opts.tag, limit: opts.limit })}`),
      get: (id) => request(`/api/links/${encodeURIComponent(id)}`)
    },
    bookmarks: {
      list: (opts = {}) => request(`/api/bookmarks${qs({ category: opts.category, favorite: opts.favorite })}`),
      get: (id) => request(`/api/bookmarks/${encodeURIComponent(id)}`)
    },
    recordings: {
      list: (opts = {}) => request(`/api/recordings${qs({ status: opts.status, limit: opts.limit })}`),
      get: (id) => request(`/api/recordings/${encodeURIComponent(id)}`),
      blobUrl: (id) => `${baseUrl}/api/recordings/${encodeURIComponent(id)}/blob`
    },
    pdfs: {
      list: (opts = {}) => request(`/api/pdfs${qs({ status: opts.status, limit: opts.limit })}`),
      get: (id) => request(`/api/pdfs/${encodeURIComponent(id)}`),
      blobUrl: (id) => `${baseUrl}/api/pdfs/${encodeURIComponent(id)}/blob`
    },
    highlights: {
      list: (opts = {}) => request(`/api/highlights${qs({ host: opts.host, limit: opts.limit, before: opts.before })}`),
      get: (id) => request(`/api/highlights/${encodeURIComponent(id)}`),
      create: (payload) => request("/api/highlights", { method: "POST", body: JSON.stringify(payload) }),
      update: (id, payload) =>
        request(`/api/highlights/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(payload) }),
      delete: (id) => request(`/api/highlights/${encodeURIComponent(id)}`, { method: "DELETE" })
    },
    scrapes: {
      listRuns: (opts = {}) =>
        request(`/api/scrapes/runs${qs({ jobId: opts.jobId, limit: opts.limit, before: opts.before })}`),
      getRun: (id) => request(`/api/scrapes/runs/${encodeURIComponent(id)}`),
      deleteRun: (id) => request(`/api/scrapes/runs/${encodeURIComponent(id)}`, { method: "DELETE" }),
      runUrl: (url, opts = {}) => request("/api/scrapes/run", { method: "POST", body: JSON.stringify({ url, ...opts }) }),
      listJobs: (opts = {}) => request(`/api/scrapes/jobs${qs({ q: opts.q, limit: opts.limit })}`),
      createJob: (payload) => request("/api/scrapes/jobs", { method: "POST", body: JSON.stringify(payload) }),
      runJob: (id) => request(`/api/scrapes/jobs/${encodeURIComponent(id)}/run`, { method: "POST" }),
      deleteJob: (id) => request(`/api/scrapes/jobs/${encodeURIComponent(id)}`, { method: "DELETE" })
    }
  }
}
