import { useEffect, useMemo, useState } from "react"
import { LeoButton, LeoIcon } from "../../components/leo"
import { openExternalLink } from "../../lib/open-url"
import { openPopupWindow } from "../../lib/popup-window"
import { getSettings } from "../../storage"
import { RecorderSection } from "../recorder/RecorderSection"
import {
  absoluteBlobUrl,
  CapturesClientError,
  deleteCapture,
  listCaptures,
  searchCaptures,
  type CaptureSearchHit,
  type CaptureSummary
} from "../../lib/captures-client"

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
  const [tab, setTab] = useState<"captures" | "recorder">("captures")
  const [items, setItems] = useState<CaptureSummary[] | null>(null)
  const [searchResults, setSearchResults] = useState<CaptureSearchHit[] | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<{ apiUrl: string; apiToken: string } | null>(null)

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

  const onDownload = async (item: CaptureSummary | CaptureSearchHit) => {
    if (!config) return
    setBusy(true)
    try {
      // Fetch the bytes and save via an object URL so the file downloads
      // regardless of the blob route's inline content-disposition.
      const res = await fetch(absoluteBlobUrl(config, item.blobUrl))
      if (!res.ok) throw new Error(`Download failed (${res.status})`)
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = objectUrl
      a.download = item.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
              {tab === "captures"
                ? items === null ? "Loading…" : `${items.length} stored`
                : "Record tab audio/video"}
            </div>
          </div>
          {tab === "captures" && (
            <LeoButton size="xs" variant="neutral" disabled={busy || !config} onClick={refresh}>
              {busy ? "Working…" : "Refresh"}
            </LeoButton>
          )}
        </div>
        <div className="grid grid-cols-2 rounded-lg border border-border/70 bg-bg/50 p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setTab("captures")}
            className={`rounded-md px-2 py-1.5 transition-colors ${
              tab === "captures" ? "bg-accent text-fg" : "text-fg/45 hover:text-fg"
            }`}
          >
            Captures
          </button>
          <button
            type="button"
            onClick={() => setTab("recorder")}
            className={`rounded-md px-2 py-1.5 transition-colors ${
              tab === "recorder" ? "bg-accent text-fg" : "text-fg/45 hover:text-fg"
            }`}
          >
            Recorder
          </button>
        </div>
        {tab === "captures" && (
          <>
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
          </>
        )}
      </div>
      {tab === "recorder" ? (
        <div className="min-h-0 flex-1 overflow-hidden">
          <RecorderSection />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
          {visible.length === 0 && !busy && !error && (
            <div className="text-[11px] text-fg/40">
              No captures yet. Click Screenshot or PDF in the sidebar rail; when capture save
              location is "cloud", uploads land here.
            </div>
          )}
          {visible.map((item) => {
            const isSearch = "score" in item
            const url = config ? absoluteBlobUrl(config, item.blobUrl) : item.blobUrl
            return (
              <div
                key={item.id}
                className="flex items-start gap-2 rounded border border-border/60 bg-card/20 px-2.5 py-2 hover:border-border"
                data-testid="capture-row"
              >
                {item.kind === "screenshot" ? (
                  <button
                    type="button"
                    onClick={() => void openPopupWindow(url)}
                    className="h-12 w-16 flex-shrink-0 overflow-hidden rounded border border-border bg-accent/30"
                    aria-label="Open capture preview"
                  >
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  </button>
                ) : (
                  <div className="flex-shrink-0 mt-0.5 rounded bg-accent/40 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-fg/60">
                    {item.kind}
                  </div>
                )}
                <div className="flex min-w-0 flex-col">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      event.preventDefault()
                      void openPopupWindow(url)
                    }}
                    className="truncate text-xs font-medium text-fg hover:text-primary"
                    title={item.filename}
                  >
                    {item.filename}
                  </a>
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
                    onClick={() => void onDownload(item)}
                    disabled={busy}
                    className="rounded p-1 text-fg/40 hover:bg-accent/40 hover:text-primary disabled:opacity-40"
                    aria-label="Download capture"
                    title="Download"
                  >
                    <LeoIcon name="download" size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(item.id)}
                    disabled={busy}
                    className="rounded p-1 text-fg/40 hover:bg-error/10 hover:text-error disabled:opacity-40"
                    aria-label="Delete capture"
                    title="Delete"
                  >
                    <LeoIcon name="trash" size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
