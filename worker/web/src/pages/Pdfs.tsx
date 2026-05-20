import { useEffect, useState } from "react"
import { Link, useParams } from "react-router-dom"
import { useAuth } from "../auth"
import type { PdfRow } from "../api"
import { EmptyState, ErrorState, Loading } from "../components/EmptyState"
import { StatusBadge } from "../components/StatusBadge"

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function Pdfs() {
  const { client } = useAuth()
  const [rows, setRows] = useState<PdfRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.pdfs.list({ limit: 100 })
      .then((res) => setRows(res.pdfs))
      .catch((err) => setError((err as Error).message))
  }, [client])

  if (error) return <ErrorState message={error} />
  if (!rows) return <Loading />
  if (rows.length === 0) return <EmptyState message="No PDFs yet." />

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <ul className="flex flex-col gap-2">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              to={`/pdfs/${p.id}`}
              className="flex items-center justify-between gap-3 rounded border border-fg/10 hover:border-fg/30 p-3"
            >
              <div className="min-w-0">
                <div className="font-medium truncate">{p.title ?? p.filename}</div>
                <div className="text-xs text-muted font-mono">
                  {p.page_count ? `${p.page_count} pages · ` : ""}{formatBytes(p.size_bytes)}
                </div>
              </div>
              <StatusBadge status={p.status} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PdfDetail() {
  const { id = "" } = useParams<{ id: string }>()
  const { client } = useAuth()
  const [row, setRow] = useState<PdfRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    client.pdfs.get(id)
      .then(setRow)
      .catch((err) => setError((err as Error).message))
  }, [id, client])

  if (error) return <ErrorState message={error} />
  if (!row) return <Loading />

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h1 className="text-lg font-medium truncate">{row.title ?? row.filename}</h1>
        <StatusBadge status={row.status} />
      </div>
      <embed
        src={client.pdfs.blobUrl(row.id)}
        type="application/pdf"
        className="w-full h-[75vh] rounded border border-fg/10 bg-bg"
      />
      {row.text_content && (
        <details className="mt-4">
          <summary className="text-sm text-muted cursor-pointer">Extracted text</summary>
          <pre className="mt-2 whitespace-pre-wrap text-sm font-mono text-fg/90 leading-relaxed">
            {row.text_content}
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
