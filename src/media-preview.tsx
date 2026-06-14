import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import "./style.css"
import "./lib/appearance-entry"
import { RECORDER_STORAGE_KEY, type RecordingMetadata } from "./types"

function MediaPreview() {
  const [recording, setRecording] = useState<RecordingMetadata | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const id = params.get("id")
    if (!id) return
    void chrome.storage.local.get(RECORDER_STORAGE_KEY).then((got) => {
      const list =
        (got[RECORDER_STORAGE_KEY] as RecordingMetadata[] | undefined) ?? []
      setRecording(list.find((item) => item.id === id) ?? null)
    })
  }, [])

  if (!recording) {
    return (
      <main className="min-h-screen bg-bg p-6 text-fg">
        <div className="text-sm text-fg/50">Recording not found</div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-bg p-6 text-fg">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="grid h-56 place-items-center rounded border border-border bg-card/40 text-xs uppercase tracking-wide text-fg/45">
          Video saved to Downloads
        </div>
        <div>
          <h1 className="break-words text-lg font-semibold">{recording.filename}</h1>
          {recording.originalFilename && (
            <div className="mt-1 break-words font-mono text-xs text-fg/45">
              {recording.originalFilename}
            </div>
          )}
        </div>
        <dl className="grid gap-2 text-sm">
          <Metadata label="Source" value={recording.source} />
          <Metadata label="Duration" value={formatDuration(recording.durationMs)} />
          <Metadata label="Size" value={formatBytes(recording.sizeBytes)} />
          <Metadata label="Created" value={recording.createdAt} />
          {recording.originUrl && <Metadata label="Origin" value={recording.originUrl} />}
        </dl>
      </div>
    </main>
  )
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 rounded border border-border bg-card/25 p-3">
      <dt className="text-[11px] uppercase tracking-wide text-fg/35">{label}</dt>
      <dd className="break-words font-mono text-xs text-fg/75">{value}</dd>
    </div>
  )
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const mm = Math.floor(s / 60)
    .toString()
    .padStart(2, "0")
  const ss = (s % 60).toString().padStart(2, "0")
  return `${mm}:${ss}`
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

createRoot(document.getElementById("root")!).render(<MediaPreview />)
