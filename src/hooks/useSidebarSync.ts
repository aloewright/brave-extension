import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatMessage, CLIBackend, Settings } from "../types"
import { BACKEND_INFO } from "../types"
import { createSidebarApiClient } from "../lib/sidebar-api"
import { getMessages, getMessagesForBackend, setMessages } from "../storage"

/**
 * Sidebar-api conversation sync. Replaces useCloudosSync — talks to the
 * Worker introduced in Phases 1–4 via /api/conversations (POST upserts by
 * id; the Worker handles embedding + Vectorize upsert).
 *
 * Strategy mirrors the cloudos hook:
 *   - One conversation per "session" per backend.
 *   - First message in a session → POST /api/conversations with no id →
 *     store the returned id keyed by `${backend}:${sessionStart}`.
 *   - Subsequent messages → POST with the existing id (debounced 3s)
 *     to re-upsert + re-embed.
 *   - Clear marker → drop the current id; the next message starts a new
 *     conversation row on the server.
 *   - Optional prune-after-sync trims older messages from local storage,
 *     never the active session.
 */

const SYNC_DEBOUNCE_MS = 3000
const SESSION_KEY = "ai-dev-sidebar-sessions"
const LAST_SYNC_KEY = "ai-dev-sidebar-last-sync"

type SessionMap = Partial<Record<CLIBackend, { conversationId: string; startedAt: number }>>

interface SyncState {
  lastSyncAt: number | null
  lastError: string | null
  pending: boolean
}

interface UseSidebarSyncOptions {
  settings: Settings | null
  messages: ChatMessage[]
}

function serializeSession(messages: ChatMessage[], backend: CLIBackend): { title: string; text: string } {
  const backendName = BACKEND_INFO[backend].name
  const userTurns = messages.filter((m) => m.role === "user")
  const firstUser = userTurns[0]?.content || ""
  const titleSnippet = firstUser.slice(0, 60).replace(/\s+/g, " ").trim()
  const date = new Date(messages[0]?.timestamp || Date.now()).toISOString().slice(0, 10)
  const title = titleSnippet
    ? `[${backendName}] ${titleSnippet}${firstUser.length > 60 ? "…" : ""}`
    : `[${backendName}] ${date}`

  const text = messages
    .filter((m) => m.role !== "clear")
    .map((m) => {
      const ts = new Date(m.timestamp).toISOString()
      const role = m.role === "user" ? "USER" : m.role === "assistant" ? backendName.toUpperCase() : m.role.toUpperCase()
      return `[${ts}] ${role}:\n${m.content}\n`
    })
    .join("\n")

  return { title, text }
}

function getActiveSession(messages: ChatMessage[], backend: CLIBackend): ChatMessage[] {
  const filtered = messages.filter((m) => !m.backend || m.backend === backend)
  let lastClearIdx = -1
  for (let i = filtered.length - 1; i >= 0; i--) {
    if (filtered[i]!.role === "clear") {
      lastClearIdx = i
      break
    }
  }
  return filtered.slice(lastClearIdx + 1)
}

export function useSidebarSync({ settings, messages }: UseSidebarSyncOptions) {
  const [state, setState] = useState<SyncState>({
    lastSyncAt: null,
    lastError: null,
    pending: false
  })
  const sessionsRef = useRef<SessionMap>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSerializedRef = useRef<Record<string, string>>({})

  useEffect(() => {
    chrome.storage.local.get([SESSION_KEY, LAST_SYNC_KEY]).then((res) => {
      sessionsRef.current = (res[SESSION_KEY] as SessionMap | undefined) ?? {}
      const lastSyncAt = res[LAST_SYNC_KEY] as number | null
      if (lastSyncAt) setState((s) => ({ ...s, lastSyncAt }))
    })
  }, [])

  const persistSessions = useCallback(async () => {
    await chrome.storage.local.set({ [SESSION_KEY]: sessionsRef.current })
  }, [])

  const sync = useCallback(
    async (backend: CLIBackend, sessionMessages: ChatMessage[]) => {
      if (!settings?.sidebarSyncEnabled) return
      if (sessionMessages.length === 0) return
      const baseUrl = settings.sidebarApiUrl?.trim()
      if (!baseUrl) return
      if (!settings.sidebarApiToken) return

      const { title, text } = serializeSession(sessionMessages, backend)
      const sessionStart = sessionMessages[0]?.timestamp || Date.now()
      const dedupeKey = `${backend}:${sessionStart}`
      if (lastSerializedRef.current[dedupeKey] === text) return

      setState((s) => ({ ...s, pending: true, lastError: null }))
      const client = createSidebarApiClient(settings.sidebarApiToken, baseUrl)

      try {
        const existing = sessionsRef.current[backend]
        const isSameSession = existing && existing.startedAt === sessionStart

        const { id } = await client.conversations.upsert({
          id: isSameSession ? existing!.conversationId : undefined,
          backend,
          title,
          content_text: text,
          started_at: sessionStart,
          message_count: sessionMessages.length
        })

        if (!isSameSession) {
          sessionsRef.current[backend] = { conversationId: id, startedAt: sessionStart }
          await persistSessions()
        }

        lastSerializedRef.current[dedupeKey] = text
        const lastSyncAt = Date.now()
        await chrome.storage.local.set({ [LAST_SYNC_KEY]: lastSyncAt })
        setState({ lastSyncAt, lastError: null, pending: false })

        if (settings.sidebarPruneAfterSync) {
          try {
            const stored = await getMessagesForBackend(backend)
            let clearIdx = -1
            for (let i = stored.length - 1; i >= 0; i--) {
              if (stored[i]!.role === "clear" && stored[i]!.timestamp < sessionStart) {
                clearIdx = i
                break
              }
            }
            if (clearIdx > 0) {
              const kept = stored.slice(clearIdx)
              const all = await getMessages()
              const others = all.filter((m) => (m.backend || "claude") !== backend)
              await setMessages([...others, ...kept])
            }
          } catch (e) {
            console.warn("[sidebar-sync] prune failed:", e)
          }
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          pending: false,
          lastError: (err as Error).message
        }))
      }
    },
    [settings, persistSessions]
  )

  useEffect(() => {
    if (!settings?.sidebarSyncEnabled || !settings.backend) return
    if (messages.length === 0) return

    const backend = settings.backend
    const activeSession = getActiveSession(messages, backend)

    const filtered = messages.filter((m) => !m.backend || m.backend === backend)
    const lastMsg = filtered[filtered.length - 1]
    if (lastMsg?.role === "clear") {
      delete sessionsRef.current[backend]
      persistSessions()
      return
    }

    if (activeSession.length === 0) return

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      sync(backend, activeSession)
    }, SYNC_DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [messages, settings, sync, persistSessions])

  const flush = useCallback(() => {
    if (!settings?.sidebarSyncEnabled) return
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    if (!settings.backend) return
    const backend = settings.backend
    const activeSession = getActiveSession(messages, backend)
    if (activeSession.length > 0) {
      void sync(backend, activeSession)
    }
  }, [settings, messages, sync])

  return { ...state, flush }
}
