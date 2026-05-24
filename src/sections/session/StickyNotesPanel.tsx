import { useEffect, useMemo, useState } from "react"
import {
  addStickyNote,
  getStickyNotes,
  removeStickyNote,
  updateStickyNote,
  type StickyNote
} from "../../lib/sticky-notes"
import { fuzzySearch } from "../_lx/utils/fuzzy"

export function StickyNotesPanel() {
  const [notes, setNotes] = useState<StickyNote[]>([])
  const [query, setQuery] = useState("")

  useEffect(() => {
    void refresh()
  }, [])

  async function refresh() {
    setNotes(await getStickyNotes())
  }

  const filtered = useMemo(
    () => fuzzySearch(notes, query, [(note) => note.text]).map((result) => result.item),
    [notes, query]
  )

  async function addNote() {
    await addStickyNote("")
    await refresh()
  }

  async function updateNote(id: string, text: string) {
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, text, updatedAt: Date.now() } : note))
    )
    await updateStickyNote(id, text)
  }

  async function removeNote(id: string) {
    await removeStickyNote(id)
    await refresh()
  }

  return (
    <div className="space-y-3" data-testid="sticky-notes-panel">
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search notes"
          className="min-w-0 flex-1 rounded border border-border bg-bg px-2 py-1 text-xs outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={addNote}
          className="h-7 w-7 rounded border border-border bg-card text-sm leading-none hover:bg-accent"
          aria-label="Add sticky note"
          title="Add sticky note"
        >
          +
        </button>
      </div>
      {filtered.length === 0 ? (
        <div className="text-[11px] text-fg/40">No notes</div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((note) => (
            <article
              key={note.id}
              className="relative rounded border border-border bg-yellow-100/90 p-2 text-yellow-950 shadow-sm dark:bg-yellow-300/80"
            >
              <button
                type="button"
                onClick={() => void removeNote(note.id)}
                className="absolute right-1 top-1 h-5 w-5 rounded text-xs leading-none hover:bg-yellow-200/80"
                aria-label="Remove note"
                title="Remove note"
              >
                x
              </button>
              <textarea
                value={note.text}
                onChange={(event) => void updateNote(note.id, event.target.value)}
                rows={Math.max(2, Math.min(12, note.text.split("\n").length + 1))}
                className="min-h-[56px] w-full resize-none bg-transparent pr-5 text-xs leading-5 outline-none"
                placeholder="Note"
              />
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
