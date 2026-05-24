import { useEffect, useMemo, useState } from "react"
import { LeoButton } from "../../components/leo"
import { openExternalLink, openExternalUrl } from "../../lib/open-url"
import { getSettings } from "../../storage"
import {
  CapturesClientError,
  deleteCapture,
  fetchCaptureBlob,
  listCaptures,
  renameCapture,
  searchCaptures,
  type CaptureSearchHit,
  type CaptureSummary
} from "../../lib/captures-client"

type CapturesConfig = { apiUrl: string; apiToken: string }
type VisibleCapture = CaptureSummary | CaptureSearchHit

/**
 * Page Captures section (ALO-468). Lists screenshots + PDFs the user has
 * uploaded to their R2 bucket via the sidebar rail's Screenshot/PDF
 * buttons (when capture save location is set to "cloud").
 *
 * The search box queries Vectorize through the Worker so the user can
 * find a capture by visible text content or page title/URL.
 *
 * If the Sidebar API isn't configured, we render a clear empty state
 * pointing the user at Settings, which is also where ALO-467's
 * destination control lives.
 */
export function CapturesSection() {
  const [items, setItems] = useState<CaptureSummary[] | null>(null)
  const [searchResults, setSearchResults] = useState<CaptureSearchHit[] | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<CapturesConfig | null>(null)

  useEffect(() => {
    void (async () => {
      const s = await getSettings()
      const apiUrl = (s.sidebarApiUrl || "").trim()
      const apiToken = (s.sidebarApiToken || "").trim()
      if (!apiUrl || !apiToken) {
        setError("Configure Sidebar API URL + token in Settings to use cloud captures.")
        setConfig(null)
        return
      }
      setConfig({ apiUrl, apiToken })
    })()
  }, [])

  useEffect(() => {
    if (!config) return
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config])

  const refresh = async () => {
    if (!config) return
    setBusy(true)
    setError(null)
    try {
      const out = await listCaptures(config)
      setItems(out)
    } catch (err) {
      setError(
        err instanceof CapturesClientError
          ? `Failed to load captures (${err.status})`
          : err instanceof Error
            ? err.message
            : String(err)
      )
    } finally {
      setBusy(false)
    }
  }

  const runSearch = async () => {
    if (!config) return
    if (!query.trim()) {
      setSearchResults(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const hits = await searchCaptures(config, query)
      setSearchResults(hits)
    } catch (err) {
      setError(
        err instanceof CapturesClientError
          ? `Search failed (${err.status})`
          : err instanceof Error
            ? err.message
            : String(err)
      )
    } finally {
      setBusy(false)
    }
  }

  const onDelete = async (id: string) => {
    if (!config) return
    setBusy(true)
    try {
      await deleteCapture(config, id)
      await refresh()
      if (searchResults) setSearchResults(searchResults.filter((h) => h.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const beginRename = (item: VisibleCapture) => {
    setEditingId(item.id)
    setDraftName(item.filename)
    setError(null)
  }

  const cancelRename = () => {
    setEditingId(null)
    setDraftName("")
  }

  const commitRename = async (item: VisibleCapture) => {
    if (!config) return
    const filename = draftName.trim()
    if (!filename || filename === item.filename) {
      cancelRename()
      return
    }
    setRenamingId(item.id)
    setError(null)
    try {
      const renamed = await renameCapture(config, item.id, filename)
      setItems((current) =>
        current?.map((capture) => (capture.id === renamed.id ? { ...capture, ...renamed } : capture)) ?? current
      )
      setSearchResults((current) =>
        current?.map((capture) =>
          capture.id === renamed.id
            ? {
                ...capture,
                filename: renamed.filename,
                sourceUrl: renamed.sourceUrl,
                sourceTitle: renamed.sourceTitle,
                blobUrl: renamed.blobUrl
              }
            : capture
        ) ?? current
      )
      cancelRename()
    } catch (err) {
      setError(
        err instanceof CapturesClientError
          ? `Rename failed (${err.status})`
          : err instanceof Error
            ? err.message
            : String(err)
      )
    } finally {
      setRenamingId(null)
    }
  }

  const openCapture = async (item: CaptureSummary | CaptureSearchHit) => {
    if (!config) return
    setOpeningId(item.id)
    setError(null)
    try {
      const blob = await fetchCaptureBlob(config, item.blobUrl)
      const objectUrl = URL.createObjectURL(blob)
      await openExternalUrl(objectUrl)
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
    } catch (err) {
      setError(
        err instanceof CapturesClientError
          ? `Failed to open capture (${err.status})`
          : err instanceof Error
            ? err.message
            : String(err)
      )
    } finally {
      setOpeningId(null)
    }
  }

  const visible = useMemo(() => {
    if (searchResults) return searchResults
    return items ?? []
  }, [items, searchResults])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-fg" data-testid="captures-section">
      <div className="border-b border-border px-4 py-3 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">Page Captures</div>
            <div className="text-xs text-fg/45">
              {items === null ? "Loading…" : `${items.length} stored`}
            </div>
          </div>
          <LeoButton size="xs" variant="neutral" disabled={busy || !config} onClick={refresh}>
            {busy ? "Working…" : "Refresh"}
          </LeoButton>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void runSearch()
              if (e.key === "Escape") {
                setQuery("")
                setSearchResults(null)
              }
            }}
            placeholder="Search filename, title, URL, or visible text"
            className="flex-1 rounded bg-input border border-border px-2 py-1 text-xs text-fg outline-none focus:border-primary/50"
            data-testid="captures-search-input"
          />
          <LeoButton size="xs" variant="primary" disabled={busy || !config} onClick={() => void runSearch()}>
            Search
          </LeoButton>
        </div>
        {error && (
          <div className="rounded bg-warning/10 px-2 py-1 text-[11px] text-warning">{error}</div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {visible.length === 0 && !busy && !error && (
          <div className="text-[11px] text-fg/40">
            No captures yet. Click Screenshot or PDF in the sidebar rail; when capture save
            location is "cloud", uploads land here.
          </div>
        )}
        {visible.map((item) => {
          const isSearch = "score" in item
          const isOpening = openingId === item.id
          const isEditing = editingId === item.id
          const isRenaming = renamingId === item.id
          return (
            <div
              key={item.id}
              className="flex items-start gap-2 rounded border border-border/60 bg-card/20 px-2.5 py-2 hover:border-border"
              data-testid="capture-row"
            >
              <CapturePreview item={item} config={config} />
              <div className="flex min-w-0 flex-col">
                {isEditing ? (
                  <form
                    className="flex min-w-0 items-center gap-1"
                    onSubmit={(event) => {
                      event.preventDefault()
                      void commitRename(item)
                    }}
                  >
                    <input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") cancelRename()
                      }}
                      autoFocus
                      disabled={isRenaming}
                      aria-label="Capture name"
                      className="min-w-0 flex-1 rounded border border-border bg-input px-1.5 py-0.5 text-xs text-fg outline-none focus:border-primary/50"
                    />
                    <button
                      type="submit"
                      disabled={isRenaming}
                      className="text-[10px] text-primary hover:text-primary/80 disabled:opacity-40"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      disabled={isRenaming}
                      className="text-[10px] text-fg/40 hover:text-fg disabled:opacity-40"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => void openCapture(item)}
                    disabled={busy || isOpening || !config}
                    className="truncate text-left text-xs font-medium text-fg hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                    title={item.filename}
                  >
                    {isOpening ? "Opening…" : isRenaming ? "Renaming…" : item.filename}
                  </button>
                )}
                {item.sourceTitle && (
                  <span className="truncate text-[10px] text-fg/50" title={item.sourceTitle}>
                    {item.sourceTitle}
                  </span>
                )}
                {item.sourceUrl && (
                  <a
                    href={item.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={openExternalLink(item.sourceUrl)}
                    className="truncate text-[10px] text-fg/40 hover:text-primary"
                  >
                    {item.sourceUrl}
                  </a>
                )}
                {isSearch && (
                  <span className="mt-0.5 truncate text-[10px] text-fg/55">
                    {(item as CaptureSearchHit).snippet}
                  </span>
                )}
              </div>
              <div className="ml-auto flex flex-shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => beginRename(item)}
                  disabled={busy || isEditing}
                  className="text-[10px] text-fg/40 hover:text-primary disabled:opacity-40"
                  aria-label="Rename capture"
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(item.id)}
                  disabled={busy}
                  className="text-[10px] text-fg/40 hover:text-error disabled:opacity-40"
                  aria-label="Delete capture"
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CapturePreview({
  item,
  config
}: {
  item: VisibleCapture
  config: CapturesConfig | null
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const canPreview = item.kind === "screenshot" && !!config

  useEffect(() => {
    if (!canPreview || !config) {
      setPreviewUrl(null)
      setFailed(false)
      return
    }

    let cancelled = false
    let objectUrl: string | null = null
    setPreviewUrl(null)
    setFailed(false)

    void (async () => {
      try {
        const blob = await fetchCaptureBlob(config, item.blobUrl)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      } catch {
        if (!cancelled) setFailed(true)
      }
    })()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [canPreview, config, item.blobUrl])

  if (!canPreview) {
    return (
      <div className="flex h-12 w-[72px] flex-shrink-0 items-center justify-center rounded bg-accent/35 text-[9px] uppercase tracking-wide text-fg/55">
        {item.kind}
      </div>
    )
  }

  return (
    <div className="h-12 w-[72px] flex-shrink-0 overflow-hidden rounded border border-border/50 bg-accent/25">
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={`${item.filename} preview`}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center px-1 text-center text-[9px] uppercase tracking-wide text-fg/45">
          {failed ? "No preview" : "Loading"}
        </div>
      )}
    </div>
  )
}
