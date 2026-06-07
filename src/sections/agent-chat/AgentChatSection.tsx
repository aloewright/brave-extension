// src/sections/agent-chat/AgentChatSection.tsx
//
// Sidebar UI for the agent-app Worker chat. Unlike the local ai-chat
// (which runs through a background orchestrator), the remote Worker does
// the LLM work + memory, so this section talks to it directly via the
// typed client in src/lib/agent-api.ts, streaming replies over SSE.

import { useEffect, useRef, useState } from "react"
import { ulid } from "../../lib/ulid"
import { getSettings } from "../../storage"
import {
  createAgentApiClient,
  type AgentApiClient,
  type AgentMessage,
  type AgentModel
} from "../../lib/agent-api"

// --- Pure reducer helpers (unit-tested in tests/agent-chat-section.test.ts) ---

/** Append a streamed delta to the in-progress assistant text. Pure. */
export function appendDelta(streaming: string, delta: string): string {
  return streaming + delta
}

/** Build an empty placeholder assistant message to fill as deltas arrive. Pure. */
export function buildPlaceholderAssistant(id: string, modelId: string): AgentMessage {
  return {
    id,
    session_id: "",
    role: "assistant",
    content: "",
    model: modelId || null,
    created_at: Date.now()
  }
}

function isConfigured(s: {
  agentApiUrl: string
  agentAccessClientId: string
  agentAccessClientSecret: string
}): boolean {
  return Boolean(s.agentApiUrl && s.agentAccessClientId && s.agentAccessClientSecret)
}

export function AgentChatSection() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraft] = useState("")
  const [streaming, setStreaming] = useState<string | null>(null)
  const [modelId, setModelId] = useState("")
  const [models, setModels] = useState<AgentModel[]>([])
  const [sending, setSending] = useState(false)

  const clientRef = useRef<AgentApiClient | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  // Initial load: settings → client → models/pref/session.
  useEffect(() => {
    void (async () => {
      const settings = await getSettings()
      if (!isConfigured(settings)) {
        setConfigured(false)
        return
      }
      setConfigured(true)
      const client = createAgentApiClient({
        baseUrl: settings.agentApiUrl,
        clientId: settings.agentAccessClientId,
        clientSecret: settings.agentAccessClientSecret
      })
      clientRef.current = client
      try {
        const [loadedModels, pref, sessions] = await Promise.all([
          client.listModels(),
          client.getModelPref().catch(() => ""),
          client.listSessions().catch(() => [])
        ])
        setModels(loadedModels)
        setModelId(pref || loadedModels[0]?.id || "")
        const active = sessions[0] ?? (await client.createSession())
        sessionIdRef.current = active.id
        const history = await client.listMessages(active.id).catch(() => [])
        setMessages(history)
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: ulid(),
            session_id: sessionIdRef.current ?? "",
            role: "assistant",
            content: `✗ ${err instanceof Error ? err.message : String(err)}`,
            model: null,
            created_at: Date.now()
          }
        ])
      }
    })()
  }, [])

  // Auto-scroll on new content.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages.length, streaming])

  const onModelChange = async (id: string) => {
    setModelId(id)
    try {
      await clientRef.current?.setModelPref(id)
    } catch {
      /* non-fatal: keep the local selection */
    }
  }

  const onSend = async () => {
    const text = draft.trim()
    const client = clientRef.current
    const sessionId = sessionIdRef.current
    if (!text || sending || !client || !sessionId) return
    setDraft("")
    setSending(true)

    const userMessage: AgentMessage = {
      id: ulid(),
      session_id: sessionId,
      role: "user",
      content: text,
      model: null,
      created_at: Date.now()
    }
    setMessages((prev) => [...prev, userMessage])
    setStreaming("")

    let acc = ""
    try {
      for await (const delta of client.streamMessage(sessionId, {
        content: text,
        modelId
      })) {
        acc = appendDelta(acc, delta)
        setStreaming(acc)
      }
      const assistant = buildPlaceholderAssistant(ulid(), modelId)
      assistant.session_id = sessionId
      assistant.content = acc
      setMessages((prev) => [...prev, assistant])
    } catch (err) {
      const assistant = buildPlaceholderAssistant(ulid(), modelId)
      assistant.session_id = sessionId
      assistant.content = `✗ ${err instanceof Error ? err.message : String(err)}`
      setMessages((prev) => [...prev, assistant])
    } finally {
      setStreaming(null)
      setSending(false)
    }
  }

  // Not-yet-loaded settings: render nothing structural to avoid a flash.
  if (configured === null) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 py-2 border-b border-default">
          <h2 className="font-semibold text-sm">Agent</h2>
        </div>
        <div className="flex-1 px-3 py-2 text-xs text-secondary">Loading…</div>
      </div>
    )
  }

  if (configured === false) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center px-3 py-2 border-b border-default">
          <h2 className="font-semibold text-sm">Agent</h2>
        </div>
        <div className="flex-1 px-3 py-4 text-sm text-secondary space-y-2">
          <p>The Agent chat is not configured yet.</p>
          <p>
            Open <span className="font-medium text-fg">Settings</span> and set the
            Agent API URL plus your Cloudflare Access service token (client id +
            secret) to start chatting.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header + model picker */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-default gap-2">
        <h2 className="font-semibold text-sm">Agent</h2>
        <select
          value={modelId}
          onChange={(e) => void onModelChange(e.target.value)}
          className="text-xs bg-bg text-fg border border-default rounded px-1 py-0.5 max-w-[60%]">
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.experimental ? " (experimental)" : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((m) => (
          <AgentMessageRow key={m.id} message={m} />
        ))}
        {streaming !== null && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-3 py-2 rounded bg-card/30 text-fg text-sm whitespace-pre-wrap">
              {streaming || "…"}
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Composer */}
      <div className="px-3 py-2 border-t border-default">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void onSend()
            }
          }}
          placeholder="Send a message (Enter to send, Shift+Enter for newline)"
          className="w-full px-2 py-1 rounded border border-default bg-bg text-fg text-sm resize-y"
          rows={2}
        />
        <div className="flex justify-end mt-1">
          <button
            onClick={() => void onSend()}
            disabled={!draft.trim() || sending}
            className="px-3 py-1 rounded bg-fg text-bg text-sm disabled:opacity-50">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentMessageRow({ message }: { message: AgentMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3 py-2 rounded bg-primary/20 text-fg text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[80%] px-3 py-2 rounded bg-card/30 text-fg text-sm whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  )
}
