import { useCallback, useEffect, useRef, useState } from "react"
import type { ChatMessage, CLIBackend, Settings } from "../types"
import { BACKEND_INFO } from "../types"
import { getMessagesForBackend, setMessages, getMessages } from "../storage"

/**
 * @deprecated since Phase 5 — superseded by useSidebarSync. Kept in the
 * repo for one release so users with the legacy `cloudosSyncEnabled`
 * setting still have history pushed somewhere while they migrate. The
 * hook short-circuits when the new `sidebarSyncEnabled` flag is on so
 * we never double-sync the same conversation to both backends.
 *
 * Old strategy preserved for reference:
 *   - One note per "session" per backend.
 *   - First message: POST /api/notes; subsequent: PUT /api/notes/:id.
 *   - Clear marker → forget the current id.
 *   - Optional prune-after-sync trims local storage.
 */

const SYNC_DEBOUNCE_MS = 3000
const SESSION_KEY = "ai-dev-cloudos-sessions"
const LAST_SYNC_KEY = "ai-dev-cloudos-last-sync"

type SessionMap = Partial<Record<CLIBackend, { noteId: string; startedAt: number }>>

interface SyncState {
  lastSyncAt: number | null
  lastError: string | null
  pending: boolean
}

interface UseCloudosSyncOptions {
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

  // Plain-text serialization — readable as a note, embedding-friendly
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

/**
 * Slice the message list into "sessions" demarcated by clear markers.
 * Returns only the LAST session for the given backend (the active one).
 */
function getActiveSession(messages: ChatMessage[], backend: CLIBackend): ChatMessage[] {
  const filtered = messages.filter((m) => !m.backend || m.backend === backend)
  // Find the index of the last clear marker — anything after it is the active session
  let lastClearIdx = -1
  for (let i = filtered.length - 1; i >= 0; i--) {
    if (filtered[i].role === "clear") {
      lastClearIdx = i
      break
    }
  }
  return filtered.slice(lastClearIdx + 1)
}

export function useCloudosSync({ settings, messages }: UseCloudosSyncOptions) {
  const [state, setState] = useState<SyncState>({
    lastSyncAt: null,
    lastError: null,
    pending: false
  })
  const sessionsRef = useRef<SessionMap>({})
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSerializedRef = useRef<Record<string, string>>({})

  // Hydrate session map + last sync time on mount
  useEffect(() => {
    chrome.storage.local.get([SESSION_KEY, LAST_SYNC_KEY]).then((res) => {
      sessionsRef.current = (res[SESSION_KEY] as SessionMap) || {}
      const lastSyncAt = res[LAST_SYNC_KEY] as number | null
      if (lastSyncAt) setState((s) => ({ ...s, lastSyncAt }))
    })
  }, [])

  const persistSessions = useCallback(async () => {
    await chrome.storage.local.set({ [SESSION_KEY]: sessionsRef.current })
  }, [])

  const sync = useCallback(
    async (backend: CLIBackend, sessionMessages: ChatMessage[]) => {
      if (!settings?.cloudosSyncEnabled) return
      // Stay out of the way when the new sidebar-api sync is on so we don't
      // double-write conversations into both backends.
      if (settings.sidebarSyncEnabled) return
      if (sessionMessages.length === 0) return
      const url = settings.cloudosNotesUrl?.trim()
      if (!url) return

      const { title, text } = serializeSession(sessionMessages, backend)
      const dedupeKey = `${backend}:${sessionMessages[0]?.timestamp || 0}`
      // Skip if nothing actually changed since last sync
      if (lastSerializedRef.current[dedupeKey] === text) return

      const headers: Record<string, string> = { "Content-Type": "application/json" }
      if (settings.cloudosServiceToken) {
        headers["X-CloudOS-Service-Token"] = settings.cloudosServiceToken
      }

      setState((s) => ({ ...s, pending: true, lastError: null }))

      try {
        const existing = sessionsRef.current[backend]
        const sessionStart = sessionMessages[0]?.timestamp || Date.now()
        const isSameSession = existing && existing.startedAt === sessionStart

        const now = new Date()
        const note_date = now.toISOString().slice(0, 10)
        const note_time = now.toISOString().slice(11, 19)

        if (isSameSession && existing) {
          // PUT update
          const res = await fetch(`${url.replace(/\/$/, "")}/${existing.noteId}`, {
            method: "PUT",
            headers,
            body: JSON.stringify({ title, content_text: text })
          })
          if (!res.ok) throw new Error(`PUT failed: ${res.status} ${await res.text().catch(() => "")}`)
        } else {
          // POST create — new session
          const res = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify({ title, content_text: text, note_date, note_time })
          })
          if (!res.ok) throw new Error(`POST failed: ${res.status} ${await res.text().catch(() => "")}`)
          const json = (await res.json()) as { id: string }
          sessionsRef.current[backend] = { noteId: json.id, startedAt: sessionStart }
          await persistSessions()
        }

        lastSerializedRef.current[dedupeKey] = text
        const lastSyncAt = Date.now()
        await chrome.storage.local.set({ [LAST_SYNC_KEY]: lastSyncAt })
        setState({ lastSyncAt, lastError: null, pending: false })

        // Prune older messages from local storage if enabled. We keep the
        // active session intact (anything since the most recent clear marker)
        // and drop everything older. The user can still scroll into history
        // via cloudos search later.
        if (settings.cloudosPruneAfterSync) {
          try {
            const stored = await getMessagesForBackend(backend)
            // Find the most recent clear marker that precedes the current
            // active session
            let clearIdx = -1
            for (let i = stored.length - 1; i >= 0; i--) {
              if (stored[i].role === "clear" && stored[i].timestamp < sessionStart) {
                clearIdx = i
                break
              }
            }
            if (clearIdx > 0) {
              // Keep clear marker + everything after it
              const kept = stored.slice(clearIdx)
              const all = await getMessages()
              const others = all.filter((m) => (m.backend || "claude") !== backend)
              await setMessages([...others, ...kept])
            }
          } catch (e) {
            // Pruning is best-effort — don't fail the sync
            console.warn("[cloudos-sync] prune failed:", e)
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

  // Debounced sync of the active session whenever messages change
  useEffect(() => {
    if (!settings?.cloudosSyncEnabled || !settings.backend) return
    if (messages.length === 0) return

    const backend = settings.backend
    const activeSession = getActiveSession(messages, backend)

    // If a clear marker is the most recent thing, drop the current session id
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

  // Manual flush (e.g., on session end / before close)
  const flush = useCallback(() => {
    if (!settings?.cloudosSyncEnabled) return
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const backend = settings.backend
    const activeSession = getActiveSession(messages, backend)
    if (activeSession.length > 0) {
      void sync(backend, activeSession)
    }
  }, [settings, messages, sync])

  return { ...state, flush }
}
