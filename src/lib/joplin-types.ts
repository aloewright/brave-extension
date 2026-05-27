// src/lib/joplin-types.ts
//
// Shared types for the Joplin clipper feature. Imported by joplin-client,
// joplin-recents, clip-extractors, the JoplinSection, and the background
// handler — single source of truth.

export type ClipMode = "simplified" | "full-html" | "selection" | "url-only"

export const CLIP_MODES: readonly ClipMode[] = [
  "simplified",
  "full-html",
  "selection",
  "url-only"
] as const

export const CLIP_MODE_LABELS: Record<ClipMode, string> = {
  "simplified":  "Simplified page",
  "full-html":   "Full HTML",
  "selection":   "Selection",
  "url-only":    "URL + title"
}

/** Output of a per-mode extractor. Exactly one of body/bodyHtml is non-null. */
export interface Clip {
  title: string
  body: string | null
  bodyHtml: string | null
  sourceUrl: string
  mode: ClipMode
}

/** Persisted recent-clip record (storage key: ai-dev-joplin-recent-clips). */
export interface RecentClip {
  id: string                 // ulid (existing src/lib/ulid.ts)
  joplinNoteId: string
  title: string
  mode: ClipMode
  sourceUrl: string
  createdAt: string          // ISO
  joplinUrl: string          // joplin://x-callback-url/openNote?id=<noteId>
}

export interface RecentClipsStore {
  clips: RecentClip[]        // newest first, capped at 50
}

/** chrome.runtime.sendMessage payload: sidebar/context menu → background. */
export interface ClipRequest {
  type: "joplin/clip"
  mode: ClipMode
  tabId: number
}

/** chrome.runtime.sendMessage broadcast: background → all listeners. */
export interface ClipResultEvent {
  type: "joplin/clip-result"
  status: "success" | "error"
  mode: ClipMode
  title?: string
  error?: string
  recentClip?: RecentClip
}

/** Map between contextMenu item IDs and ClipMode. Used by background.ts. */
export const MENU_ID_TO_MODE: Record<string, ClipMode> = {
  "joplin-clip-simplified": "simplified",
  "joplin-clip-full":       "full-html",
  "joplin-clip-selection":  "selection",
  "joplin-clip-url":        "url-only"
}
