// Same-origin agent API client for the web SPA. Unlike the extension client,
// this makes RELATIVE `/api/...` requests with no Access headers: the Cloudflare
// edge injects `Cf-Access-Jwt-Assertion` on same-origin requests, which the
// Worker's requireAccess middleware validates. SSE parsing mirrors the approach
// in src/chat.ts (toTextDeltaStream): buffer / split on "\n" / strip "data:" /
// stop on "[DONE]" / JSON-parse the delta, releasing the reader lock in finally.

export type ModelKind = "workers-ai" | "advanced"

export interface AgentModel {
  id: string
  label: string
  kind: ModelKind
  experimental?: boolean
}

export interface AgentSession {
  id: string
  user_id: string
  title: string
  created_at: number
  updated_at: number
}

export interface AgentMessage {
  id: string
  session_id: string
  role: string
  content: string
  model: string | null
  created_at: number
}

export interface StreamOptions {
  content: string
  modelId?: string
  advanced?: boolean
  signal?: AbortSignal
}

async function json<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init)
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${input} failed: ${res.status}`)
  }
  return (await res.json()) as T
}

export interface WebAgentClient {
  listModels(): Promise<AgentModel[]>
  getModelPref(): Promise<string>
  setModelPref(modelId: string): Promise<string>
  listSessions(): Promise<AgentSession[]>
  createSession(title?: string): Promise<AgentSession>
  listMessages(sessionId: string): Promise<AgentMessage[]>
  streamMessage(sessionId: string, opts: StreamOptions): AsyncGenerator<string, void, unknown>
}

export function createWebAgentClient(): WebAgentClient {
  return {
    async listModels() {
      const data = await json<{ models: AgentModel[] }>("/api/models")
      return data.models
    },

    async getModelPref() {
      const data = await json<{ modelId: string }>("/api/prefs/model")
      return data.modelId
    },

    async setModelPref(modelId: string) {
      const data = await json<{ modelId: string }>("/api/prefs/model", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modelId })
      })
      return data.modelId
    },

    async listSessions() {
      const data = await json<{ sessions: AgentSession[] }>("/api/sessions")
      return data.sessions
    },

    async createSession(title?: string) {
      const data = await json<{ session: AgentSession }>("/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(title ? { title } : {})
      })
      return data.session
    },

    async listMessages(sessionId: string) {
      const data = await json<{ messages: AgentMessage[] }>(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages`
      )
      return data.messages
    },

    async *streamMessage(sessionId: string, opts: StreamOptions) {
      const res = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/messages/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            content: opts.content,
            modelId: opts.modelId,
            advanced: opts.advanced === true
          }),
          signal: opts.signal
        }
      )
      if (!res.ok || !res.body) {
        throw new Error(`stream failed: ${res.status}`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ""
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            buf += decoder.decode() // flush any trailing multi-byte char
            break
          }
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith("data:")) continue
            const data = t.slice(5).trim()
            if (data === "") continue
            if (data === "[DONE]") return
            try {
              const obj = JSON.parse(data) as {
                delta?: string
                response?: string
                choices?: Array<{ delta?: { content?: string } }>
              }
              const delta = obj.delta ?? obj.response ?? obj.choices?.[0]?.delta?.content ?? ""
              if (delta) yield delta
            } catch {
              /* ignore non-JSON keepalive lines */
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    }
  }
}
