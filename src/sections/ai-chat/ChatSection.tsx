// src/sections/ai-chat/ChatSection.tsx
//
// Sidebar UI for the AI chat. Passive view over chrome.runtime
// broadcasts — all chat logic lives in src/background/chat-orchestrator.

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { MarkdownText } from "../../components/MarkdownText"
import { ulid } from "../../lib/ulid"
import {
  getConversation,
  clearConversation
} from "../../lib/ai-chat-store"
import { captureAmbient } from "../../lib/ai-chat-tools"
import type {
  ChatMessage,
  ChatTurnDoneEvent,
  ChatTurnUpdateEvent,
  ChatSendRequest,
  ChatStopRequest
} from "../../lib/ai-chat-types"

const SIDEBAR_TIMEOUT_MS = 60_000

export function ChatSection() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [compactHead, setCompactHead] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [turnInFlight, setTurnInFlight] = useState<string | null>(null)
  const lastUpdateAtRef = useRef<number>(0)
  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const shouldPinToBottomRef = useRef(true)
  const hasPositionedInitialScrollRef = useRef(false)

  // Initial load
  useEffect(() => {
    void (async () => {
      const conv = await getConversation()
      setMessages(conv.messages)
      setCompactHead(conv.compactedHead?.summary ?? null)
    })()
  }, [])

  // Listen for broadcasts
  useEffect(() => {
    const listener = (msg: unknown) => {
      if (!msg || typeof msg !== "object") return
      const ev = msg as ChatTurnUpdateEvent | ChatTurnDoneEvent
      if (ev.type === "ai-chat/turn-update") {
        setMessages((prev) => {
          // Dedup against the snapshot or any earlier append by id.
          if (prev.some((m) => m.id === ev.appendedMessage.id)) return prev
          return [...prev, ev.appendedMessage]
        })
        setTurnInFlight(ev.turnId)
        lastUpdateAtRef.current = Date.now()
      } else if (ev.type === "ai-chat/turn-done") {
        // Surface error reasons as ephemeral assistant messages. Without
        // this the orchestrator's emitError broadcasts only ever toggle
        // turnInFlight off — the user sees their message clear and then
        // nothing, which is the most common "no results" report.
        if (ev.reason === "error" && ev.errorMessage) {
          setMessages((prev) => [
            ...prev,
            {
              id: ulid(),
              role: "assistant",
              content: `✗ ${ev.errorMessage}`,
              turnId: ev.turnId,
              createdAt: new Date().toISOString()
            }
          ])
        }
        setTurnInFlight(null)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // SW-eviction recovery: if no turn-update or turn-done arrives for 60s
  // while a turn is in flight, synthesize a local "turn lost" state.
  useEffect(() => {
    if (!turnInFlight) {
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current)
      return
    }
    const check = () => {
      const since = Date.now() - lastUpdateAtRef.current
      if (since >= SIDEBAR_TIMEOUT_MS) {
        setMessages((prev) => [
          ...prev,
          {
            id: ulid(),
            role: "assistant",
            content: "Turn lost — background may have restarted. Send again.",
            turnId: turnInFlight,
            createdAt: new Date().toISOString()
          }
        ])
        setTurnInFlight(null)
      } else {
        timeoutTimerRef.current = setTimeout(check, SIDEBAR_TIMEOUT_MS - since + 1000)
      }
    }
    timeoutTimerRef.current = setTimeout(check, SIDEBAR_TIMEOUT_MS)
    return () => {
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current)
    }
  }, [turnInFlight])

  // Keep bottom-pinned chats pinned without replaying a long smooth scroll
  // through history when the section mounts.
  useLayoutEffect(() => {
    const el = messagesScrollRef.current
    if (!el) return
    if (!hasPositionedInitialScrollRef.current || shouldPinToBottomRef.current) {
      el.scrollTop = el.scrollHeight
      hasPositionedInitialScrollRef.current = true
      shouldPinToBottomRef.current = true
    }
  }, [messages.length])

  const onSend = async () => {
    const text = draft.trim()
    if (!text || turnInFlight) return
    setDraft("")
    const userMessageId = ulid()
    const ambient = await captureAmbient()
    const req: ChatSendRequest = {
      type: "ai-chat/send",
      userMessageId,
      text,
      ambient
    }
    void chrome.runtime.sendMessage(req)
  }

  const onStop = async () => {
    if (!turnInFlight) return
    const req: ChatStopRequest = { type: "ai-chat/stop", turnId: turnInFlight }
    void chrome.runtime.sendMessage(req)
  }

  const onClear = async () => {
    if (turnInFlight) return
    await clearConversation()
    setMessages([])
    setCompactHead(null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-default">
        <h2 className="font-semibold text-sm">AI Chat</h2>
        <button
          onClick={onClear}
          className="text-xs text-secondary hover:text-fg disabled:opacity-50"
          disabled={!!turnInFlight}>
          Clear
        </button>
      </div>

      {/* Compacted head banner */}
      {compactHead && (
        <div className="px-3 py-2 text-xs bg-card/30 border-b border-default text-secondary">
          Compacted earlier turns:{" "}
          {compactHead.slice(0, 200)}
          {compactHead.length > 200 ? "…" : ""}
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesScrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          shouldPinToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32
        }}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
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
          placeholder="Ask anything (Enter to send, Shift+Enter for newline)"
          className="w-full px-2 py-1 rounded border border-default bg-bg text-fg text-sm resize-y"
          rows={2}
        />
        <div className="flex justify-end gap-2 mt-1">
          {turnInFlight && (
            <button
              onClick={onStop}
              className="px-3 py-1 rounded border border-red-500 text-red-500 text-sm">
              Stop
            </button>
          )}
          <button
            onClick={onSend}
            disabled={!draft.trim() || !!turnInFlight}
            className="px-3 py-1 rounded bg-fg text-bg text-sm disabled:opacity-50">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] px-3 py-2 rounded bg-primary/20 text-fg text-sm whitespace-pre-wrap">
          {message.content}
        </div>
      </div>
    )
  }
  if (message.role === "tool") {
    return (
      <details className="ml-4 text-xs">
        <summary className="cursor-pointer text-secondary">
          {message.toolError ? "× tool error" : "✓ tool result"}
        </summary>
        <pre className="mt-1 px-2 py-1 bg-card/20 rounded overflow-x-auto">
          {message.toolError ?? message.content}
        </pre>
      </details>
    )
  }
  if (message.role === "assistant" && message.toolCall) {
    const argsPreview = message.toolCall.argumentsRaw.slice(0, 80)
    return (
      <div className="ml-2 text-xs font-mono text-secondary">
        ▶ {message.toolCall.name}({argsPreview}
        {message.toolCall.argumentsRaw.length > 80 ? "…" : ""})
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
