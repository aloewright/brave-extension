import { useEffect, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useAuth } from "../auth"
import type { ResourceType, SearchHit } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"

const TYPE_LABEL: Record<ResourceType, string> = {
  conversation: "Conversation",
  link: "Link",
  bookmark: "Bookmark",
  recording: "Recording",
  pdf: "PDF",
  capture: "Capture",
  highlight: "Highlight",
  scrape: "Scrape"
}

function detailPathFor(hit: SearchHit): string {
  switch (hit.type) {
    case "conversation": return `/conversations/${hit.id}`
    case "link": return `/links` // (no detail page for links; goes to list)
    case "bookmark": return `/bookmarks`
    case "recording": return `/recordings/${hit.id}`
    case "pdf": return `/pdfs/${hit.id}`
    case "capture": return `/search`
    case "highlight": return `/highlights`
    case "scrape": return `/scrapes`
  }
}

export function Search() {
  const { client } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const initial = searchParams.get("q") ?? ""
  const [query, setQuery] = useState(initial)
  const [committed, setCommitted] = useState(initial)
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = committed.trim()
    if (!q) { setHits(null); setError(null); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    client.search(q, { limit: 30 })
      .then((res) => { if (!cancelled) setHits(res.results) })
      .catch((err) => { if (!cancelled) setError((err as Error).message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [committed, client])

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setCommitted(query)
    setSearchParams(query.trim() ? { q: query } : {})
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <form onSubmit={submit} className="flex gap-2">
        <input
          type="search"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search your highlights, conversations, links, bookmarks, recordings, pdfs, scrapes..."
          className="flex-1 rounded border border-fg/20 bg-bg px-3 py-2 text-fg outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded bg-accent px-3 py-2 text-bg font-medium disabled:opacity-50"
          disabled={!query.trim()}
        >Search</button>
      </form>

      <div className="mt-6">
        {loading && <Loading />}
        {error && <ErrorState message={error} />}
        {hits && hits.length === 0 && !loading && <EmptyState message="No results." />}
        {hits && hits.length > 0 && (
          <ul className="flex flex-col gap-2">
            {hits.map((h) => (
              <li key={`${h.type}:${h.id}:${h.chunkIndex}`}>
                <Link
                  to={detailPathFor(h)}
                  className="block rounded border border-fg/10 hover:border-fg/30 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs uppercase tracking-wide text-muted">{TYPE_LABEL[h.type]}</span>
                    <span className="text-xs font-mono text-muted">score {h.score.toFixed(3)}</span>
                  </div>
                  <div className="mt-1 font-medium">{h.title}</div>
                  <div className="mt-1 text-sm text-muted line-clamp-3">{h.snippet}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {!committed && !loading && <EmptyState message="Type a query above and press Enter." />}
      </div>
    </div>
  )
}
