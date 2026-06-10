// src/sections/agent-chat/AgentChatSection.tsx
//
// Sidebar UI for the agent-app Worker chat. Unlike the local ai-chat
// (which runs through a background orchestrator), the remote Worker does
// the LLM work + memory, so this section talks to it directly via the
// typed client in src/lib/agent-api.ts, streaming replies over SSE.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { LeoIcon } from "../../components/leo"
import { MarkdownText } from "../../components/MarkdownText"
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

function isPinnedToBottom(el: HTMLDivElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 32
}

function formatAgentChatMarkdown(input: {
  messages: AgentMessage[]
  streaming: string | null
  sessionId: string | null
  modelId: string
}): string {
  const rows = [...input.messages]
  if (input.streaming?.trim()) {
    rows.push({
      id: "streaming",
      session_id: input.sessionId ?? "",
      role: "assistant",
      content: input.streaming,
      model: input.modelId || null,
      created_at: Date.now()
    })
  }
  const header = [
    "# Agent conversation",
    "",
    `Exported: ${new Date().toLocaleString()}`,
    input.sessionId ? `Session: ${input.sessionId}` : "",
    input.modelId ? `Model: ${input.modelId}` : ""
  ].filter(Boolean)
  const body = rows.map((message) => {
    const when = message.created_at ? new Date(message.created_at).toLocaleString() : ""
    const model = message.model ? ` · ${message.model}` : ""
    return [
      `## ${message.role}${when ? ` · ${when}` : ""}${model}`,
      "",
      message.content.trim() || "_Empty message_"
    ].join("\n")
  })
  return [...header, "", ...body].join("\n\n")
}

function downloadAgentConversation(input: {
  messages: AgentMessage[]
  streaming: string | null
  sessionId: string | null
  modelId: string
}) {
  if (input.messages.length === 0 && !input.streaming?.trim()) return
  const markdown = formatAgentChatMarkdown(input)
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const objectUrl = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }))
  const a = document.createElement("a")
  a.href = objectUrl
  a.download = `agent-conversation-${stamp}.md`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(objectUrl)
}

export function AgentChatSection({ active = true }: { active?: boolean }) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [messages, setMessages] = useState<AgentMessage[]>([])
  const [draft, setDraft] = useState("")
  const [streaming, setStreaming] = useState<string | null>(null)
  const [modelId, setModelId] = useState("")
  const [models, setModels] = useState<AgentModel[]>([])
  const [sending, setSending] = useState(false)

  const clientRef = useRef<AgentApiClient | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const shouldPinToBottomRef = useRef(true)
  const hasPositionedInitialScrollRef = useRef(false)

  // Abort any in-flight stream when the section unmounts (tab switch).
  useEffect(() => () => abortRef.current?.abort(), [])

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

  // Keep bottom-pinned chats pinned without replaying a long smooth scroll
  // through history when the section mounts or becomes visible.
  useLayoutEffect(() => {
    const el = messagesScrollRef.current
    if (!active || !el) return
    if (!hasPositionedInitialScrollRef.current || shouldPinToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      hasPositionedInitialScrollRef.current = true
      shouldPinToBottomRef.current = true
    }
  }, [active, messages.length, streaming])

  const onModelChange = async (id: string) => {
    setModelId(id)
    try {
      await clientRef.current?.setModelPref(id)
    } catch {
      /* non-fatal: keep the local selection */
    }
  }

  const onClear = async () => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(null)
    setSending(false)
    setDraft("")
    const client = clientRef.current
    if (!client) {
      sessionIdRef.current = null
      setMessages([])
      return
    }
    try {
      const next = await client.createSession("New chat")
      sessionIdRef.current = next.id
      setMessages([])
      shouldPinToBottomRef.current = true
      hasPositionedInitialScrollRef.current = false
    } catch (err) {
      setMessages([
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
  }

  const onSave = () => {
    downloadAgentConversation({
      messages,
      streaming,
      sessionId: sessionIdRef.current,
      modelId
    })
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

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    let acc = ""
    try {
      for await (const delta of client.streamMessage(sessionId, {
        content: text,
        modelId,
        signal: controller.signal
      })) {
        acc = appendDelta(acc, delta)
        setStreaming(acc)
      }
      const assistant = buildPlaceholderAssistant(ulid(), modelId)
      assistant.session_id = sessionId
      assistant.content = acc.trim()
        ? acc
        : "⚠️ The model returned an empty response. Try again or pick a different model."
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
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onSave}
            disabled={messages.length === 0 && !streaming?.trim()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-fg/45 transition-colors hover:bg-accent/50 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
            title="Save conversation"
            aria-label="Save conversation"
          >
            <LeoIcon name="save" size={15} />
          </button>
          <button
            type="button"
            onClick={() => void onClear()}
            disabled={sending}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-fg/45 transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-35"
            title="Clear conversation"
            aria-label="Clear conversation"
          >
            <LeoIcon name="trash" size={15} />
          </button>
          <select
            value={modelId}
            onChange={(e) => void onModelChange(e.target.value)}
            className="min-w-0 max-w-[12rem] text-xs bg-bg text-fg border border-default rounded px-1 py-0.5">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {m.experimental ? " (experimental)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={messagesScrollRef}
        onScroll={(e) => {
          shouldPinToBottomRef.current = isPinnedToBottom(e.currentTarget)
        }}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((m) => (
          <AgentMessageRow key={m.id} message={m} />
        ))}
        {streaming !== null && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-3 py-2 rounded bg-card/30 text-fg text-sm">
              {streaming ? <MarkdownText content={streaming} /> : "…"}
            </div>
          </div>
        )}
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
      <div className="max-w-[80%] px-3 py-2 rounded bg-card/30 text-fg text-sm">
        <MarkdownText content={message.content} />
      </div>
    </div>
  )
}
