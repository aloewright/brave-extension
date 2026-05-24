/**
 * Typed client for the sidebar-api Worker (Phases 1–4 of this project).
 * Mirrors the API surface in worker/web/src/api.ts so extension code and
 * the SPA stay consistent. Add new methods here when the Worker adds new
 * routes; the SPA copy can be regenerated.
 */

export type ResourceType = "conversation" | "link" | "bookmark" | "recording" | "pdf"

export interface SearchHit {
  type: ResourceType
  id: string
  chunkIndex: number
  score: number
  title: string
  snippet: string
  createdAt: number
}

export interface ConversationUpsertPayload {
  id?: string
  backend: string
  title: string
  content_text: string
  started_at: number
  message_count: number
}

export interface LinkUpsertPayload {
  id?: string
  url: string
  title: string
  description?: string | null
  tags?: string[]
  favicon?: string | null
  source?: string
}

export interface BookmarkPayload {
  id: string
  url: string
  title: string
  parentId?: string | null
  path?: string[]
  category: string
  isFavorite?: boolean
  dateAdded?: number | null
  index?: number | null
}

export interface RecordingUploadMetadata {
  id: string
  filename: string
  mime_type?: string
  duration_ms?: number
  source?: "tab" | "screen" | "camera"
  origin_url?: string | null
}

export interface BrowserAgentSession {
  id: string
  objective: string
  status: string
  nextStep: string
  compactSummary: string
  tokenEstimate: number
  memoryRefs: unknown[]
  lastObservation: unknown
  pendingConsent: unknown
  createdAt: string
  updatedAt: string
  cloudUse?: BrowserAgentCloudUse
}

export interface BrowserAgentCloudUse {
  planning?: boolean
  vision?: boolean
  ocr?: boolean
}

export interface BrowserAgentChatPayload {
  sessionId?: string
  message: string
  objective?: string
  observation?: unknown
  cloudUse?: BrowserAgentCloudUse
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

export interface SidebarApiClient {
  health: () => Promise<{ ok: boolean; version: string; deployedAt: string }>
  search: (query: string, opts?: { types?: ResourceType[]; limit?: number }) => Promise<{ results: SearchHit[] }>
  conversations: {
    upsert: (payload: ConversationUpsertPayload) => Promise<{ id: string; chunkCount: number }>
  }
  links: {
    upsert: (payload: LinkUpsertPayload) => Promise<{ id: string; created: boolean; chunkCount: number }>
  }
  bookmarks: {
    snapshot: (
      bookmarks: BookmarkPayload[],
      pulledAt?: string
    ) => Promise<{ inserted: number; updated: number; deleted: number; reembedded: number }>
  }
  recordings: {
    upload: (
      blob: Blob,
      metadata: RecordingUploadMetadata
    ) => Promise<{ id: string; status: string; r2_key: string; workflow_id: string | null }>
  }
  agent: {
    chat: (payload: BrowserAgentChatPayload) => Promise<{
      session: BrowserAgentSession
      reply: string
      plan: { objective: string; status: string; nextStep: string; stopCondition: string }
      provider: string
      compacted: boolean
    }>
    createSession: (payload: { sessionId?: string; objective?: string; observation?: unknown; compactSummary?: string }) => Promise<{ session: BrowserAgentSession }>
    appendMessage: (
      sessionId: string,
      payload: { role: "user" | "assistant" | "tool" | "system" | "observation"; content: string; observation?: unknown }
    ) => Promise<{ message: unknown; session: BrowserAgentSession; compactRecommended: boolean }>
    compact: (sessionId: string) => Promise<{ session: BrowserAgentSession; compacted: boolean }>
    remember: (sessionId: string, key: string, value: string) => Promise<{ memory: { id: string; key: string; value: string; createdAt: string } }>
    searchMemory: (sessionId: string, query: string) => Promise<{ results: Array<{ id: string; key: string; value: string; createdAt: string }> }>
  }
}

export function createSidebarApiClient(token: string, baseUrl: string): SidebarApiClient {
  const cleanBase = baseUrl.replace(/\/+$/, "")

  async function jsonRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    if (token) headers.set("x-sidebar-token", token)
    if (init.body && typeof init.body === "string" && !headers.has("content-type")) {
      headers.set("content-type", "application/json")
    }
    const res = await fetch(`${cleanBase}${path}`, { ...init, headers })
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
      const code = body?.error?.code ?? "http_error"
      const message = body?.error?.message ?? `request failed: ${res.status}`
      throw new ApiError(res.status, code, message)
    }
    return (await res.json()) as T
  }

  return {
    health: () => jsonRequest("/api/health"),
    search: (query, opts = {}) =>
      jsonRequest("/api/search", {
        method: "POST",
        body: JSON.stringify({ query, types: opts.types, limit: opts.limit })
      }),
    conversations: {
      upsert: (payload) =>
        jsonRequest("/api/conversations", { method: "POST", body: JSON.stringify(payload) })
    },
    links: {
      upsert: (payload) =>
        jsonRequest("/api/links", { method: "POST", body: JSON.stringify(payload) })
    },
    bookmarks: {
      snapshot: (bookmarks, pulledAt = new Date().toISOString()) =>
        jsonRequest("/api/bookmarks/snapshot", {
          method: "POST",
          body: JSON.stringify({ bookmarks, pulledAt })
        })
    },
    recordings: {
      upload: async (blob, metadata) => {
        const form = new FormData()
        form.set("metadata", JSON.stringify(metadata))
        form.set("file", blob, metadata.filename)
        const headers = new Headers()
        if (token) headers.set("x-sidebar-token", token)
        const res = await fetch(`${cleanBase}/api/recordings`, { method: "POST", body: form, headers })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
          throw new ApiError(res.status, body?.error?.code ?? "http_error", body?.error?.message ?? `upload failed: ${res.status}`)
        }
        return (await res.json()) as { id: string; status: string; r2_key: string; workflow_id: string | null }
      }
    },
    agent: {
      chat: (payload) =>
        jsonRequest("/api/agent/chat", {
          method: "POST",
          body: JSON.stringify(payload)
        }),
      createSession: (payload) =>
        jsonRequest("/api/agent/sessions", {
          method: "POST",
          body: JSON.stringify(payload)
        }),
      appendMessage: (sessionId, payload) =>
        jsonRequest(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          body: JSON.stringify(payload)
        }),
      compact: (sessionId) =>
        jsonRequest(`/api/agent/sessions/${encodeURIComponent(sessionId)}/compact`, {
          method: "POST"
        }),
      remember: (sessionId, key, value) =>
        jsonRequest(`/api/agent/sessions/${encodeURIComponent(sessionId)}/memory`, {
          method: "POST",
          body: JSON.stringify({ key, value })
        }),
      searchMemory: (sessionId, query) => {
        const params = new URLSearchParams({ q: query })
        return jsonRequest(`/api/agent/sessions/${encodeURIComponent(sessionId)}/memory/search?${params.toString()}`)
      }
    }
  }
}
