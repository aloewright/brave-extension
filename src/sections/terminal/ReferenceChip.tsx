import { useMemo, useState } from "react"
import { truncate } from "../../lib/text"
import type { Reference } from "../../types"

interface Props {
  reference: Reference
  onRemove: (id: string) => void
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ""
  }
}

export function ReferenceChip({ reference, onRemove }: Props) {
  const [open, setOpen] = useState(false)

  // chrome://favicon/ is unavailable in MV3. Use Google's s2 favicon service
  // as the simplest cross-origin-friendly option; fall back gracefully if the
  // request fails so the chip never breaks layout.
  const faviconUrl = useMemo(() => {
    const host = hostOf(reference.url)
    if (!host) return null
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
  }, [reference.url])

  const onDragStart = (e: React.DragEvent) => {
    // Drop handler in TerminalView writes this token via the PTY.
    e.dataTransfer.setData("text/plain", `@${reference.id}`)
    e.dataTransfer.effectAllowed = "copy"
  }

  return (
    <div className="relative">
      <div
        draggable
        onDragStart={onDragStart}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-2 py-1 rounded bg-bg/60 border border-border hover:border-primary/50 text-xs cursor-grab active:cursor-grabbing select-none">
        {faviconUrl ? (
          <img
            src={faviconUrl}
            alt=""
            className="w-3.5 h-3.5 rounded-sm"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).style.display = "none"
            }}
          />
        ) : (
          <span className="w-3.5 h-3.5 inline-block rounded-sm bg-fg/10" aria-hidden />
        )}
        <span className="font-mono text-fg/80 truncate max-w-[10rem]" title={reference.title}>
          {truncate(reference.title || reference.url || reference.id, 24)}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onRemove(reference.id)
          }}
          className="text-fg/30 hover:text-fg/80 ml-0.5"
          title="Remove reference">
          ×
        </button>
      </div>
      {open && (
        <div
          className="absolute z-20 left-0 top-full mt-1 w-80 max-w-[90vw] p-3 rounded border border-border bg-bg shadow-lg text-xs space-y-2"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-medium text-fg truncate" title={reference.title}>
                {reference.title || "(untitled)"}
              </div>
              <a
                href={reference.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary/80 hover:text-primary truncate block"
                title={reference.url}>
                {reference.url}
              </a>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-fg/40 hover:text-fg"
              title="Close preview">
              ×
            </button>
          </div>
          <div className="font-mono text-fg/60 break-all" title={reference.selector}>
            {reference.selector}
          </div>
          {reference.screenshot && (
            <img
              src={reference.screenshot}
              alt="screenshot"
              className="w-full max-h-32 object-contain rounded border border-border bg-black/40"
            />
          )}
          <pre className="whitespace-pre-wrap break-all max-h-24 overflow-auto text-[10px] text-fg/60 bg-bg/40 p-1.5 rounded border border-border">
            {truncate(reference.outerHTML || "", 600)}
          </pre>
          <div className="text-[10px] text-fg/40">
            id <span className="font-mono">{reference.id}</span> · drag chip into terminal to insert
            <span className="font-mono"> @{reference.id}</span>
          </div>
        </div>
      )}
    </div>
  )
}
