import { useEffect, useState } from "react"
import { useAuth } from "../auth"
import type { HighlightRow } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"

interface Draft {
  text: string
  note: string
  tags: string
  sourceTitle: string
  sourceUrl: string
}

function parseTags(tags: string): string[] {
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(ms))
}

function draftFrom(row: HighlightRow): Draft {
  return {
    text: row.text,
    note: row.note ?? "",
    tags: parseTags(row.tags).join(", "),
    sourceTitle: row.source_title ?? "",
    sourceUrl: row.source_url ?? ""
  }
}

function tagsFromDraft(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean)
}

function hostLabel(row: HighlightRow): string {
  if (row.source_host) return row.source_host
  if (!row.source_url) return "Unknown source"
  try {
    return new URL(row.source_url).hostname
  } catch {
    return "Unknown source"
  }
}

export function Highlights() {
  const { client } = useAuth()
  const [rows, setRows] = useState<HighlightRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    client.highlights.list({ limit: 200 })
      .then((res) => { if (!cancelled) setRows(res.highlights) })
      .catch((err) => { if (!cancelled) setError((err as Error).message) })
    return () => { cancelled = true }
  }, [client])

  function startEdit(row: HighlightRow) {
    setEditingId(row.id)
    setDraft(draftFrom(row))
    setError(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setDraft(null)
  }

  async function save(row: HighlightRow) {
    if (!draft || !draft.text.trim()) return
    setSavingId(row.id)
    setError(null)
    try {
      const updated = await client.highlights.update(row.id, {
        text: draft.text,
        note: draft.note || null,
        tags: tagsFromDraft(draft.tags),
        sourceTitle: draft.sourceTitle || null,
        sourceUrl: draft.sourceUrl || null
      })
      setRows((current) => current?.map((item) => item.id === updated.id ? updated : item) ?? current)
      cancelEdit()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSavingId(null)
    }
  }

  async function remove(row: HighlightRow) {
    setDeletingId(row.id)
    setError(null)
    try {
      await client.highlights.delete(row.id)
      setRows((current) => current?.filter((item) => item.id !== row.id) ?? current)
      if (editingId === row.id) cancelEdit()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  if (error && !rows) return <ErrorState message={error} />
  if (!rows) return <Loading />

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold">Highlights</h1>
          <p className="mt-1 text-sm text-muted">{rows.length} saved</p>
        </div>
      </header>

      {error && <ErrorState message={error} />}
      {rows.length === 0 && <EmptyState message="No highlights saved yet." />}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const tags = parseTags(row.tags)
          const isEditing = editingId === row.id && draft
          return (
            <li
              key={row.id}
              className="flex min-h-80 flex-col gap-4 rounded-lg border border-fg/10 bg-surface p-4 shadow-[0_18px_45px_rgba(0,0,0,0.16)]"
            >
              <div className="flex items-start gap-3">
                {row.source_favicon ? (
                  <img src={row.source_favicon} alt="" className="mt-1 h-5 w-5 shrink-0 rounded" />
                ) : (
                  <span className="mt-1 h-5 w-5 shrink-0 rounded bg-fg/10" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {row.source_title || hostLabel(row)}
                  </div>
                  <div className="truncate text-xs text-muted">{hostLabel(row)}</div>
                </div>
              </div>

              {isEditing ? (
                <div className="flex flex-1 flex-col gap-3">
                  <textarea
                    value={draft.text}
                    onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                    rows={7}
                    className="min-h-36 resize-y rounded border border-fg/20 bg-bg px-3 py-2 text-sm leading-6 text-fg outline-none focus:border-accent"
                  />
                  <textarea
                    value={draft.note}
                    onChange={(event) => setDraft({ ...draft, note: event.target.value })}
                    rows={2}
                    placeholder="Note"
                    className="resize-y rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
                  />
                  <input
                    value={draft.tags}
                    onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                    placeholder="tags"
                    className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
                  />
                  <input
                    value={draft.sourceTitle}
                    onChange={(event) => setDraft({ ...draft, sourceTitle: event.target.value })}
                    placeholder="source title"
                    className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
                  />
                  <input
                    value={draft.sourceUrl}
                    onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })}
                    placeholder="source url"
                    className="rounded border border-fg/20 bg-bg px-3 py-2 text-sm text-fg outline-none placeholder:text-muted focus:border-accent"
                  />
                </div>
              ) : (
                <div className="flex flex-1 flex-col gap-3">
                  <blockquote className="whitespace-pre-wrap text-sm leading-6 text-fg">
                    {row.text}
                  </blockquote>
                  {row.note && <p className="rounded bg-bg/45 p-3 text-sm text-fg/90">{row.note}</p>}
                  {tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span key={tag} className="rounded border border-fg/10 px-2 py-1 text-xs text-fg/90">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-fg/10 pt-3">
                <div className="min-w-0 text-xs text-muted">
                  <div>{formatDate(row.created_at)}</div>
                  {row.source_url && (
                    <a href={row.source_url} target="_blank" rel="noreferrer" className="block truncate hover:text-fg">
                      Open source
                    </a>
                  )}
                </div>
                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void save(row)}
                        disabled={savingId === row.id || !draft.text.trim()}
                        className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg disabled:opacity-50"
                      >
                        {savingId === row.id ? "Saving" : "Save"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => startEdit(row)}
                        className="rounded bg-accent px-3 py-1.5 text-xs font-semibold text-bg"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(row)}
                        disabled={deletingId === row.id}
                        className="rounded border border-fg/20 px-3 py-1.5 text-xs font-semibold text-fg hover:bg-fg/10 disabled:opacity-50"
                      >
                        {deletingId === row.id ? "Deleting" : "Delete"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
