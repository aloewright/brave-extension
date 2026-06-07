import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createWebAgentClient,
  type AgentMessage,
  type AgentModel
} from "./api"

const client = createWebAgentClient()

interface ChatBubble {
  role: "user" | "assistant"
  content: string
}

export function ChatPage() {
  const qc = useQueryClient()
  const [input, setInput] = useState("")
  const [modelId, setModelId] = useState<string>("")
  const [bubbles, setBubbles] = useState<ChatBubble[]>([])
  const [streaming, setStreaming] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Abort any in-flight stream on unmount.
  useEffect(() => () => abortRef.current?.abort(), [])

  const modelsQuery = useQuery<AgentModel[]>({
    queryKey: ["models"],
    queryFn: () => client.listModels()
  })

  const prefQuery = useQuery<string>({
    queryKey: ["model-pref"],
    queryFn: () => client.getModelPref()
  })

  // Ensure an active session exists (use the first, else create one).
  const sessionQuery = useQuery({
    queryKey: ["active-session"],
    queryFn: async () => {
      const existing = await client.listSessions()
      const sess = existing[0] ?? (await client.createSession())
      const msgs = await client.listMessages(sess.id)
      return { id: sess.id, messages: msgs }
    }
  })

  // Seed local bubbles from the loaded session once.
  const sessionId = sessionQuery.data?.id
  const loadedMessages = sessionQuery.data?.messages
  useEffect(() => {
    if (!loadedMessages) return
    setBubbles(
      loadedMessages
        .filter((m): m is AgentMessage => m.role === "user" || m.role === "assistant")
        .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    )
  }, [loadedMessages])

  // Pick the preferred model once both queries resolve.
  useEffect(() => {
    if (!modelId && prefQuery.data) setModelId(prefQuery.data)
  }, [prefQuery.data, modelId])

  const models = useMemo(() => modelsQuery.data ?? [], [modelsQuery.data])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [bubbles, streaming])

  async function send() {
    const content = input.trim()
    if (!content || busy || !sessionId) return
    setError(null)
    setInput("")
    setBubbles((b) => [...b, { role: "user", content }])
    setBusy(true)
    setStreaming("")

    const ac = new AbortController()
    abortRef.current = ac
    let acc = ""
    try {
      const advanced = models.find((m) => m.id === modelId)?.kind === "advanced"
      for await (const delta of client.streamMessage(sessionId, {
        content,
        modelId: modelId || undefined,
        advanced,
        signal: ac.signal
      })) {
        acc += delta
        setStreaming(acc)
      }
      setBubbles((b) => [...b, { role: "assistant", content: acc }])
    } catch (err) {
      if (!ac.signal.aborted) {
        setError(err instanceof Error ? err.message : "stream failed")
        if (acc) setBubbles((b) => [...b, { role: "assistant", content: acc }])
      }
    } finally {
      setStreaming("")
      setBusy(false)
      abortRef.current = null
      void qc.invalidateQueries({ queryKey: ["active-session"] })
    }
  }

  async function onModelChange(next: string) {
    setModelId(next)
    try {
      await client.setModelPref(next)
    } catch {
      /* preference is best-effort */
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="chat">
      <header className="chat-header">
        <h1>Agent</h1>
        <select
          className="model-picker"
          value={modelId}
          onChange={(e) => void onModelChange(e.target.value)}
          aria-label="Model"
        >
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
              {m.experimental ? " (experimental)" : ""}
            </option>
          ))}
        </select>
      </header>

      <div className="messages" ref={scrollRef}>
        {bubbles.map((b, i) => (
          <div key={i} className={`bubble ${b.role}`}>
            {b.content}
          </div>
        ))}
        {streaming && <div className="bubble assistant streaming">{streaming}</div>}
        {error && <div className="error">{error}</div>}
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Send a message (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={!sessionId}
        />
        <button onClick={() => void send()} disabled={busy || !input.trim() || !sessionId}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  )
}
