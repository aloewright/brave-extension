import { useEffect, useState } from "react"
import { useAuth } from "../auth"
import type { LinkRow } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"

function parseTags(t: string): string[] {
  try {
    const parsed = JSON.parse(t)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function Links() {
  const { client } = useAuth()
  const [rows, setRows] = useState<LinkRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.links.list({ limit: 200 })
      .then((res) => setRows(res.links))
      .catch((err) => setError((err as Error).message))
  }, [client])

  if (error) return <ErrorState message={error} />
  if (!rows) return <Loading />
  if (rows.length === 0) return <EmptyState message="No links saved yet." />

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ul className="flex flex-col gap-2">
        {rows.map((l) => {
          const tags = parseTags(l.tags)
          return (
            <li key={l.id}>
              <a
                href={l.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded border border-fg/10 hover:border-fg/30 p-3"
              >
                {l.favicon ? (
                  <img src={l.favicon} alt="" className="w-4 h-4 shrink-0" />
                ) : (
                  <span className="inline-block w-4 h-4 rounded bg-fg/10 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{l.title}</div>
                  <div className="text-xs text-muted truncate">{l.url}</div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {tags.map((t) => (
                    <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-fg/10 text-fg/80">
                      {t}
                    </span>
                  ))}
                </div>
              </a>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
