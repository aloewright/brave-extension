import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useAuth } from "../auth"
import type { RecordingRow } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"
import { StatusBadge } from "../components/StatusBadge"

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const mm = Math.floor(s / 60).toString().padStart(2, "0")
  const ss = (s % 60).toString().padStart(2, "0")
  return `${mm}:${ss}`
}
function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function Recordings() {
  const { client } = useAuth()
  const [rows, setRows] = useState<RecordingRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.recordings.list({ limit: 100 })
      .then((res) => setRows(res.recordings))
      .catch((err) => setError((err as Error).message))
  }, [client])

  if (error) return <ErrorState message={error} />
  if (!rows) return <Loading />
  if (rows.length === 0) return <EmptyState message="No recordings yet." />

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => (
          <li key={r.id}>
            <Link
              to={`/recordings/${r.id}`}
              className="block rounded border border-fg/10 hover:border-fg/30 p-3"
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs uppercase tracking-wide text-muted">{r.source}</span>
                <StatusBadge status={r.status} />
              </div>
              <div className="font-medium truncate" title={r.filename}>{r.filename}</div>
              <div className="mt-1 text-xs font-mono text-muted">
                {formatDuration(r.duration_ms)} · {formatBytes(r.size_bytes)}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function RecordingDetail() {
  const { id = "" } = useParams<{ id: string }>()
  const { client } = useAuth()
  const [row, setRow] = useState<RecordingRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.recordings.get(id)
      .then(setRow)
      .catch((err) => setError((err as Error).message))
  }, [id, client])

  if (error) return <ErrorState message={error} />
  if (!row) return <Loading />

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h1 className="text-lg font-medium truncate">{row.filename}</h1>
        <StatusBadge status={row.status} />
      </div>
      <video
        src={client.recordings.blobUrl(row.id)}
        controls
        className="w-full max-h-[60vh] rounded border border-fg/10 bg-black"
      />
      {row.transcript && (
        <details className="mt-4" open>
          <summary className="text-sm text-muted cursor-pointer">Transcript</summary>
          <pre className="mt-2 whitespace-pre-wrap text-sm font-mono text-fg/90 leading-relaxed">
            {row.transcript}
          </pre>
        </details>
      )}
      {row.status === "failed" && row.status_message && (
        <div className="mt-4 text-sm text-red-400" role="alert">
          Ingest failed: {row.status_message}
        </div>
      )}
    </div>
  )
}
