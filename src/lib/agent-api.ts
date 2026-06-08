/**
 * Typed client for the agent-app Worker (Plans 1–2 of this project).
 * Wraps the Worker's REST + SSE endpoints, authenticating with a Cloudflare
 * Access service token (CF-Access-Client-Id / CF-Access-Client-Secret).
 * Mirrors the conventions in src/lib/sidebar-api.ts.
 */

export interface AgentApiConfig {
  baseUrl: string
  clientId: string
  clientSecret: string
}

export interface AgentModel {
  id: string
  label: string
  kind: "workers-ai" | "advanced"
  experimental?: boolean
}
export interface AgentSession {
  id: string
  title: string
  created_at?: number
  updated_at?: number
}
export interface AgentMessage {
  id: string
  session_id: string
  role: string
  content: string
  model: string | null
  created_at: number
}

export interface ToolSourceState {
  id: string
  status:
    | { state: "connected"; tools: number }
    | { state: "degraded"; tools: number; reason: string }
    | { state: "needs-auth"; reason: string }
    | { state: "needs-config"; reason: string }
    | { state: "failed"; reason: string }
}

export class AgentApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = "AgentApiError"
  }
}

export interface AgentApiClient {
  health(): Promise<boolean>
  listModels(): Promise<AgentModel[]>
  getToolStatus(): Promise<ToolSourceState[]>
  getModelPref(): Promise<string>
  setModelPref(modelId: string): Promise<string>
  listSessions(): Promise<AgentSession[]>
  createSession(title?: string): Promise<AgentSession>
  listMessages(sessionId: string): Promise<AgentMessage[]>
  streamMessage(
    sessionId: string,
    opts: { content: string; modelId?: string; advanced?: boolean; signal?: AbortSignal }
  ): AsyncGenerator<string>
}

export function createAgentApiClient(cfg: AgentApiConfig): AgentApiClient {
  const base = cfg.baseUrl.replace(/\/+$/, "")
  function authHeaders(extra?: HeadersInit): Headers {
    const h = new Headers(extra)
    h.set("cf-access-client-id", cfg.clientId)
    h.set("cf-access-client-secret", cfg.clientSecret)
    return h
  }
  async function jsonReq<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = authHeaders(init.headers)
    if (init.body) headers.set("content-type", "application/json")
    const res = await fetch(`${base}${path}`, { ...init, headers })
    if (!res.ok) throw new AgentApiError(res.status, `${init.method ?? "GET"} ${path} → ${res.status}`)
    return (await res.json()) as T
  }

  return {
    async health() {
      try {
        const res = await fetch(`${base}/api/health`)
        return res.ok
      } catch {
        return false
      }
    },
    async listModels() {
      return (await jsonReq<{ models: AgentModel[] }>("/api/models")).models
    },
    async getToolStatus() {
      return (await jsonReq<{ sources: ToolSourceState[] }>("/api/agent/tools/status")).sources
    },
    async getModelPref() {
      return (await jsonReq<{ modelId: string }>("/api/prefs/model")).modelId
    },
    async setModelPref(modelId) {
      return (
        await jsonReq<{ modelId: string }>("/api/prefs/model", {
          method: "PUT",
          body: JSON.stringify({ modelId })
        })
      ).modelId
    },
    async listSessions() {
      return (await jsonReq<{ sessions: AgentSession[] }>("/api/sessions")).sessions
    },
    async createSession(title) {
      return (
        await jsonReq<{ session: AgentSession }>("/api/sessions", {
          method: "POST",
          body: JSON.stringify({ title: title ?? "New chat" })
        })
      ).session
    },
    async listMessages(sessionId) {
      return (await jsonReq<{ messages: AgentMessage[] }>(`/api/sessions/${sessionId}/messages`)).messages
    },
    async *streamMessage(sessionId, opts) {
      const headers = authHeaders({ "content-type": "application/json" })
      const res = await fetch(`${base}/api/sessions/${sessionId}/messages/stream`, {
        method: "POST",
        headers,
        body: JSON.stringify({ content: opts.content, modelId: opts.modelId, advanced: opts.advanced }),
        signal: opts.signal
      })
      if (!res.ok || !res.body) throw new AgentApiError(res.status, `stream → ${res.status}`)
      const reader = res.body.getReader()
      const dec = new TextDecoder()
      let buf = ""
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith("data:")) continue
            const data = t.slice(5).trim()
            if (data === "" || data === "[DONE]") continue
            try {
              const obj = JSON.parse(data) as { delta?: string }
              if (obj.delta) yield obj.delta
            } catch {
              /* ignore keepalives */
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    }
  }
}
