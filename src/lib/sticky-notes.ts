export interface StickyNote {
  id: string
  text: string
  createdAt: number
  updatedAt: number
}

export const STICKY_NOTES_STORAGE_KEY = "lx_stickyNotes"
export const STICKY_NOTES_LIMIT = 200

export async function getStickyNotes(): Promise<StickyNote[]> {
  const got = await chrome.storage.local.get(STICKY_NOTES_STORAGE_KEY)
  const notes = got[STICKY_NOTES_STORAGE_KEY]
  return Array.isArray(notes) ? notes.filter(isStickyNote) : []
}

export async function setStickyNotes(notes: StickyNote[]): Promise<void> {
  const capped = notes.slice(0, STICKY_NOTES_LIMIT)
  await chrome.storage.local.set({ [STICKY_NOTES_STORAGE_KEY]: capped })
}

export async function addStickyNote(text = ""): Promise<StickyNote> {
  const now = Date.now()
  const note: StickyNote = {
    id: crypto.randomUUID(),
    text,
    createdAt: now,
    updatedAt: now
  }
  const notes = await getStickyNotes()
  await setStickyNotes([note, ...notes])
  return note
}

export async function updateStickyNote(id: string, text: string): Promise<void> {
  const notes = await getStickyNotes()
  await setStickyNotes(
    notes.map((note) =>
      note.id === id ? { ...note, text, updatedAt: Date.now() } : note
    )
  )
}

export async function removeStickyNote(id: string): Promise<void> {
  const notes = await getStickyNotes()
  await setStickyNotes(notes.filter((note) => note.id !== id))
}

function isStickyNote(value: unknown): value is StickyNote {
  if (!value || typeof value !== "object") return false
  const note = value as StickyNote
  return (
    typeof note.id === "string" &&
    typeof note.text === "string" &&
    typeof note.createdAt === "number" &&
    typeof note.updatedAt === "number"
  )
}
