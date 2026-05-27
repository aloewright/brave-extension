// src/sections/joplin/JoplinSection.tsx
//
// Sidebar UI for the Joplin clipper. Mode picker, Clip button, recent
// clips list, status dot. Passive view over chrome.runtime broadcasts
// of "joplin/clip-result" — background owns the actual clip logic.

import { useEffect, useMemo, useState } from "react"
import { Storage } from "@plasmohq/storage"
import {
  CLIP_MODES,
  CLIP_MODE_LABELS,
  type ClipMode,
  type ClipResultEvent,
  type RecentClip
} from "../../lib/joplin-types"
import { ping } from "../../lib/joplin"
import {
  getRecentClips,
  clearRecentClips
} from "../../lib/joplin-recents"

const LAST_MODE_KEY = "ai-dev-joplin-last-mode"
const lastModeStorage = new Storage()

export function JoplinSection() {
  const [mode, setMode] = useState<ClipMode>("simplified")
  const [status, setStatus] = useState<"green" | "red" | "unknown">("unknown")
  const [clipping, setClipping] = useState(false)
  const [recents, setRecents] = useState<RecentClip[]>([])
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null)

  // Mount: load recents + last mode + ping.
  useEffect(() => {
    void (async () => {
      const lastMode = await lastModeStorage.get<ClipMode>(LAST_MODE_KEY)
      if (lastMode && CLIP_MODES.includes(lastMode)) setMode(lastMode)
      setRecents(await getRecentClips())
      setStatus((await ping()) ? "green" : "red")
    })()
  }, [])

  // Re-poll status every 30s while mounted.
  useEffect(() => {
    const id = window.setInterval(async () => {
      setStatus((await ping()) ? "green" : "red")
    }, 30_000)
    return () => window.clearInterval(id)
  }, [])

  // Listen for clip-result broadcasts.
  useEffect(() => {
    const listener = (msg: unknown) => {
      if (!msg || typeof msg !== "object") return
      const ev = msg as ClipResultEvent
      if (ev.type !== "joplin/clip-result") return
      if (ev.status === "success") {
        setToast({ kind: "success", msg: `Clipped: ${ev.title ?? "(untitled)"}` })
        if (ev.recentClip) {
          setRecents((prev) => [ev.recentClip!, ...prev].slice(0, 50))
        }
      } else {
        setToast({ kind: "error", msg: ev.error ?? "Clip failed." })
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 3000)
    return () => window.clearTimeout(id)
  }, [toast])

  const onSelectMode = (m: ClipMode) => {
    setMode(m)
    void lastModeStorage.set(LAST_MODE_KEY, m)
  }

  const onClip = async () => {
    if (clipping) return
    setClipping(true)
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      if (!tab?.id) {
        setToast({ kind: "error", msg: "No active tab." })
        return
      }
      // Fire-and-forget; the result comes back via the chrome.runtime broadcast.
      await chrome.runtime.sendMessage({ type: "joplin/clip", mode, tabId: tab.id })
    } finally {
      window.setTimeout(() => setClipping(false), 300)
    }
  }

  const statusDotColor = useMemo(
    () =>
      status === "green"
        ? "bg-green-500"
        : status === "red"
        ? "bg-red-500"
        : "bg-gray-400",
    [status]
  )

  return (
    <div className="p-3 space-y-3 text-sm">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={`inline-block w-2 h-2 rounded-full ${statusDotColor}`} />
        <h2 className="font-semibold">Joplin</h2>
        <span className="text-xs text-secondary">
          {status === "green"
            ? "connected"
            : status === "red"
            ? "unreachable"
            : "checking…"}
        </span>
      </div>

      {/* Mode picker */}
      <div className="grid grid-cols-2 gap-2">
        {CLIP_MODES.map((m) => (
          <button
            key={m}
            onClick={() => onSelectMode(m)}
            className={`px-2 py-1 rounded border text-xs ${
              mode === m ? "border-fg bg-fg/10" : "border-default text-secondary"
            }`}>
            {CLIP_MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Clip button */}
      <button
        disabled={clipping}
        onClick={onClip}
        className="w-full px-3 py-2 rounded bg-fg text-bg font-medium disabled:opacity-50">
        {clipping ? "Clipping…" : `Clip ${CLIP_MODE_LABELS[mode]}`}
      </button>

      {/* Toast */}
      {toast && (
        <div
          className={`text-xs rounded px-2 py-1 ${
            toast.kind === "success"
              ? "bg-green-500/15 text-green-500"
              : "bg-red-500/15 text-red-500"
          }`}>
          {toast.msg}
        </div>
      )}

      {/* Recent clips */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-secondary">Recent clips</h3>
          {recents.length > 0 && (
            <button
              onClick={async () => {
                await clearRecentClips()
                setRecents([])
              }}
              className="text-xs text-secondary hover:text-fg">
              Clear
            </button>
          )}
        </div>
        {recents.length === 0 ? (
          <p className="text-xs text-secondary">No clips yet.</p>
        ) : (
          <ul className="space-y-1 max-h-80 overflow-y-auto">
            {recents.map((c) => (
              <li key={c.id} className="text-xs">
                <a
                  href={c.joplinUrl}
                  className="block truncate hover:underline"
                  title={c.title}>
                  {c.title}
                </a>
                <span className="text-secondary">
                  {CLIP_MODE_LABELS[c.mode]} · {relativeTime(c.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const sec = Math.max(0, Math.floor((now - then) / 1000))
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  return `${day}d ago`
}
