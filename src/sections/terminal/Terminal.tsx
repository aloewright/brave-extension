import { useEffect, useRef } from "react"
import { Terminal as XTerm } from "xterm"
import { FitAddon } from "xterm-addon-fit"
import { WebLinksAddon } from "xterm-addon-web-links"
import "xterm/css/xterm.css"

interface Props {
  sessionId: string
  active: boolean
  onWrite: (data: string) => void
  onResize: (cols: number, rows: number) => void
  registerData: (sessionId: string, sink: (data: string) => void) => void
  unregisterData: (sessionId: string) => void
}

export function TerminalView({
  sessionId,
  active,
  onWrite,
  onResize,
  registerData,
  unregisterData
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const xterm = new XTerm({
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 12,
      cursorBlink: true,
      convertEol: true,
      allowProposedApi: true,
      theme: {
        background: "#0a0a0a",
        foreground: "#e6e6e6",
        cursor: "#e6e6e6"
      }
    })
    const fit = new FitAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(new WebLinksAddon())
    xterm.open(containerRef.current)

    xtermRef.current = xterm
    fitRef.current = fit

    fit.fit()
    onResize(xterm.cols, xterm.rows)

    const writeDisposable = xterm.onData((data) => onWrite(data))
    const resizeDisposable = xterm.onResize(({ cols, rows }) => onResize(cols, rows))

    registerData(sessionId, (data) => xterm.write(data))

    const ro = new ResizeObserver(() => {
      try {
        fit.fit()
      } catch {
        /* no-op during teardown */
      }
    })
    ro.observe(containerRef.current)

    return () => {
      ro.disconnect()
      writeDisposable.dispose()
      resizeDisposable.dispose()
      unregisterData(sessionId)
      xterm.dispose()
      xtermRef.current = null
      fitRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (active) {
      requestAnimationFrame(() => {
        try {
          fitRef.current?.fit()
          xtermRef.current?.focus()
        } catch {
          /* ignore */
        }
      })
    }
  }, [active])

  // Accept drops from the references tray. Chips set dataTransfer "text/plain"
  // to "@<refId>"; we forward the token to the PTY as if it were typed so the
  // running CLI sees it on stdin.
  //
  // Reference ids are minted in `background.finalizeCapture` as
  // `ref_<ULID>` (Crockford base32, see src/lib/ulid.ts), so the dragged
  // token is `@ref_<ULID>` — e.g. `@ref_01HX0123456789ABCDEFGHJKMN`.
  // The regex enforces that exact shape so stray text/plain payloads from
  // other drag sources (e.g. selected text in the page) are ignored.
  const REF_TOKEN = /^@ref_[A-Z0-9]+$/i

  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes("text/plain")) {
      e.preventDefault()
      e.dataTransfer.dropEffect = "copy"
    }
  }

  const onDrop = (e: React.DragEvent) => {
    const text = e.dataTransfer.getData("text/plain")
    if (!text) return
    if (!REF_TOKEN.test(text)) return
    e.preventDefault()
    onWrite(text)
    requestAnimationFrame(() => xtermRef.current?.focus())
  }

  return (
    <div
      ref={containerRef}
      onDragOver={onDragOver}
      onDrop={onDrop}
      className={`absolute inset-0 ${active ? "block" : "hidden"}`}
      style={{ background: "#0a0a0a" }}
    />
  )
}
