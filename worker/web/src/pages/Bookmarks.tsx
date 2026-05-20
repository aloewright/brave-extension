import { useEffect, useState } from "react"
import { useAuth } from "../auth"
import type { BookmarkRow } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"

export function Bookmarks() {
  const { client } = useAuth()
  const [rows, setRows] = useState<BookmarkRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)

  useEffect(() => {
    client.bookmarks.list({ favorite: favoritesOnly || undefined })
      .then((res) => setRows(res.bookmarks))
      .catch((err) => setError((err as Error).message))
  }, [client, favoritesOnly])

  if (error) return <ErrorState message={error} />
  if (!rows) return <Loading />

  const grouped = new Map<string, BookmarkRow[]>()
  for (const r of rows) {
    const list = grouped.get(r.category) ?? []
    list.push(r)
    grouped.set(r.category, list)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
        <input
          type="checkbox"
          checked={favoritesOnly}
          onChange={(e) => setFavoritesOnly(e.target.checked)}
          className="accent-accent"
        />
        Favorites only
      </label>

      {rows.length === 0 && <EmptyState message="No bookmarks synced yet." />}

      {Array.from(grouped.entries()).map(([category, list]) => (
        <section key={category} className="mb-6">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-2">{category}</h2>
          <ul className="flex flex-col gap-1">
            {list.map((b) => (
              <li key={b.id}>
                <a
                  href={b.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded hover:bg-fg/5 px-2 py-1"
                >
                  {b.is_favorite === 1 && <span className="text-accent" aria-label="favorite">★</span>}
                  <span className="font-medium truncate">{b.title}</span>
                  <span className="text-xs text-muted truncate flex-1">{b.url}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
