import { getSettings } from "../storage"

export interface StickyNote {
  id: string
  text: string
  createdAt: number
  updatedAt: number
}

export const STICKY_NOTES_STORAGE_KEY = "lx_stickyNotes"

const syncTimers = new Map<string, ReturnType<typeof setTimeout>>()

function createStickyNoteId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function stickyNoteTitle(text: string): string {
  const firstLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean)
  return (firstLine || "Session note").slice(0, 160)
}

function noteApiUrl(baseUrl: string, id?: string): string {
  const normalized = baseUrl.replace(/\/+$/, "")
  const notesPath = normalized.endsWith("/api") ? "/notes" : "/api/notes"
  return `${normalized}${notesPath}${id ? `/${encodeURIComponent(id)}` : ""}`
}

async function getSyncConfig(): Promise<{ baseUrl: string; token: string } | null> {
  const settings = await getSettings()
  const baseUrl = settings.sidebarApiUrl?.trim()
  const token = settings.sidebarApiToken?.trim()

  if (!settings.sidebarSyncEnabled || !baseUrl || !token) {
    return null
  }

  return { baseUrl, token }
}

async function syncStickyNote(note: StickyNote): Promise<void> {
  try {
    const config = await getSyncConfig()
    if (!config) return

    await fetch(noteApiUrl(config.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
        "X-Sidebar-Token": config.token,
        "X-Sidebar-API-Token": config.token,
      },
      body: JSON.stringify({
        id: note.id,
        title: stickyNoteTitle(note.text),
        text: note.text,
        tags: ["session", "sticky-note"],
        source: "session",
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      }),
    })
  } catch {
    // Sticky notes should remain usable offline; local storage is the source of truth until sync succeeds.
  }
}

async function removeRemoteStickyNote(id: string): Promise<void> {
  try {
    const config = await getSyncConfig()
    if (!config) return

    await fetch(noteApiUrl(config.baseUrl, id), {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "X-Sidebar-Token": config.token,
        "X-Sidebar-API-Token": config.token,
      },
    })
  } catch {
    // Keep local deletion snappy even if the hub API is temporarily unavailable.
  }
}

function scheduleStickyNoteSync(note: StickyNote): void {
  const existingTimer = syncTimers.get(note.id)
  if (existingTimer) clearTimeout(existingTimer)

  syncTimers.set(
    note.id,
    setTimeout(() => {
      syncTimers.delete(note.id)
      void syncStickyNote(note)
    }, 500),
  )
}

export async function getStickyNotes(): Promise<StickyNote[]> {
  const result = await chrome.storage.local.get(STICKY_NOTES_STORAGE_KEY)
  return Array.isArray(result[STICKY_NOTES_STORAGE_KEY]) ? result[STICKY_NOTES_STORAGE_KEY] : []
}

export async function setStickyNotes(notes: StickyNote[]): Promise<void> {
  await chrome.storage.local.set({ [STICKY_NOTES_STORAGE_KEY]: notes })
}

export async function addStickyNote(text = ""): Promise<StickyNote> {
  const now = Date.now()
  const note: StickyNote = {
    id: createStickyNoteId(),
    text,
    createdAt: now,
    updatedAt: now,
  }

  const notes = await getStickyNotes()
  await setStickyNotes([note, ...notes])
  scheduleStickyNoteSync(note)
  return note
}

export async function updateStickyNote(id: string, text: string): Promise<void> {
  const notes = await getStickyNotes()
  let updatedNote: StickyNote | null = null

  const nextNotes = notes.map((note) => {
    if (note.id !== id) return note
    updatedNote = { ...note, text, updatedAt: Date.now() }
    return updatedNote
  })

  await setStickyNotes(nextNotes)

  if (updatedNote) {
    scheduleStickyNoteSync(updatedNote)
  }
}

export async function removeStickyNote(id: string): Promise<void> {
  const timer = syncTimers.get(id)
  if (timer) clearTimeout(timer)
  syncTimers.delete(id)

  const notes = await getStickyNotes()
  await setStickyNotes(notes.filter((note) => note.id !== id))
  void removeRemoteStickyNote(id)
}
