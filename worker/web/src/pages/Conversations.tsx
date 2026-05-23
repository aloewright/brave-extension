import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useAuth } from "../auth"
import type { ConversationRow } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"

export function Conversations() {
  const { client } = useAuth()
  const [rows, setRows] = useState<ConversationRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.conversations.list({ limit: 100 })
      .then((res) => setRows(res.conversations))
      .catch((err) => setError((err as Error).message))
  }, [client])

  if (error) return <ErrorState message={error} />
  if (!rows) return <Loading />
  if (rows.length === 0) return <EmptyState message="No conversations yet." />

  const grouped = new Map<string, ConversationRow[]>()
  for (const r of rows) {
    const list = grouped.get(r.backend) ?? []
    list.push(r)
    grouped.set(r.backend, list)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {Array.from(grouped.entries()).map(([backend, list]) => (
        <section key={backend} className="mb-8">
          <h2 className="text-sm uppercase tracking-wide text-muted mb-2">{backend}</h2>
          <ul className="flex flex-col gap-2">
            {list.map((c) => (
              <li key={c.id}>
                <Link
                  to={`/conversations/${c.id}`}
                  className="block rounded border border-fg/10 hover:border-fg/30 p-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium truncate">{c.title}</span>
                    <span className="text-xs font-mono text-muted shrink-0">
                      {c.message_count} msg · {new Date(c.updated_at).toLocaleString()}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function ConversationDetail() {
  const { id = "" } = useParams<{ id: string }>()
  const { client } = useAuth()
  const [row, setRow] = useState<ConversationRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.conversations.get(id)
      .then(setRow)
      .catch((err) => setError((err as Error).message))
  }, [id, client])

  if (error) return <ErrorState message={error} />
  if (!row) return <Loading />

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h1 className="text-lg font-medium">{row.title}</h1>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(row.content_text)}
          className="text-xs text-muted hover:text-fg"
          title="Copy transcript to clipboard"
        >Copy all</button>
      </div>
      <pre className="whitespace-pre-wrap text-sm font-mono text-fg/90 leading-relaxed">
        {row.content_text}
      </pre>
    </div>
  )
}
