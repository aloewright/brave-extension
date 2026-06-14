import { useMemo, useState } from "react"

import { PretextTextBlock } from "../../components/PretextTextBlock"
import { LeoIcon } from "../../components/leo"

type PageStudioPage = "type" | "elements" | "markup"
type FontKind = "sans" | "serif" | "mono" | "display" | "hand"
type MarkupTool = "highlight" | "box" | "note"

interface FontOption {
  label: string
  kind: FontKind
  stack: string
}

interface StudioResponse {
  ok?: boolean
  error?: string
  text?: string
  count?: number
  tagName?: string
  label?: string
}

const FONT_OPTIONS: FontOption[] = [
  { label: "Atkinson Hyperlegible", kind: "sans", stack: '"Atkinson Hyperlegible", "Avenir Next", sans-serif' },
  { label: "Avenir Next", kind: "sans", stack: '"Avenir Next", "Helvetica Neue", sans-serif' },
  { label: "Gill Sans", kind: "sans", stack: '"Gill Sans", "Gill Sans MT", sans-serif' },
  { label: "Charter", kind: "serif", stack: 'Charter, "Bitstream Charter", "Sitka Text", serif' },
  { label: "Iowan Old Style", kind: "serif", stack: '"Iowan Old Style", "Palatino Linotype", serif' },
  { label: "Georgia", kind: "serif", stack: 'Georgia, "Times New Roman", serif' },
  { label: "Berkeley Mono", kind: "mono", stack: '"Berkeley Mono", "SF Mono", ui-monospace, monospace' },
  { label: "SF Mono", kind: "mono", stack: '"SF Mono", ui-monospace, monospace' },
  { label: "Menlo", kind: "mono", stack: 'Menlo, Monaco, Consolas, monospace' },
  { label: "Bodoni 72", kind: "display", stack: '"Bodoni 72", Didot, "Bodoni 72 Smallcaps", serif' },
  { label: "Copperplate", kind: "display", stack: 'Copperplate, "Copperplate Gothic Light", fantasy' },
  { label: "Impact Condensed", kind: "display", stack: 'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif' },
  { label: "Bradley Hand", kind: "hand", stack: '"Bradley Hand", "Marker Felt", cursive' },
  { label: "Comic Neue-ish", kind: "hand", stack: '"Comic Sans MS", "Comic Sans", cursive' }
]

const FONT_KIND_LABELS: Record<FontKind | "all", string> = {
  all: "All",
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
  display: "Display",
  hand: "Hand"
}

function compactSelection(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return "No active text selection"
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) throw new Error("No active tab")
  return tab
}

async function sendStudioMessage<T extends StudioResponse>(message: Record<string, unknown>): Promise<T> {
  const tab = await activeTab()
  return new Promise<T>((resolve, reject) => {
    chrome.tabs.sendMessage(tab.id!, message, (response) => {
      const err = chrome.runtime.lastError
      if (err) {
        reject(new Error(`${err.message}. Reload the page if this tab was open before Page Studio was installed.`))
        return
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Page Studio command failed"))
        return
      }
      resolve(response as T)
    })
  })
}

async function captureVisiblePng(): Promise<string> {
  const tab = await activeTab()
  return chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
}

export function PageStudioSection() {
  const [page, setPage] = useState<PageStudioPage>("type")
  const [fontKind, setFontKind] = useState<FontKind | "all">("all")
  const [fontStack, setFontStack] = useState(FONT_OPTIONS[0].stack)
  const [fontSize, setFontSize] = useState(18)
  const [fontWeight, setFontWeight] = useState(600)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [textColor, setTextColor] = useState("#111827")
  const [textBackground, setTextBackground] = useState("#fff7ad")
  const [elementColor, setElementColor] = useState("#111827")
  const [elementBackground, setElementBackground] = useState("#f7efe3")
  const [elementOutline, setElementOutline] = useState("#ff6b35")
  const [markupColor, setMarkupColor] = useState("#ff6b35")
  const [noteText, setNoteText] = useState("Rework this section")
  const [markupTool, setMarkupTool] = useState<MarkupTool>("highlight")
  const [selection, setSelection] = useState("")
  const [status, setStatus] = useState("Select text on the page, then pull it into Page Studio.")
  const [busy, setBusy] = useState(false)
  const [lastCapture, setLastCapture] = useState<string | null>(null)

  const filteredFonts = useMemo(
    () => FONT_OPTIONS.filter((font) => fontKind === "all" || font.kind === fontKind),
    [fontKind]
  )

  const run = async (label: string, command: () => Promise<string | void>) => {
    setBusy(true)
    try {
      const message = await command()
      setStatus(message || label)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const loadSelection = () =>
    run("Selection loaded", async () => {
      const response = await sendStudioMessage<StudioResponse>({ type: "PAGE_STUDIO_GET_SELECTION" })
      setSelection(response.text || "")
      return response.text ? "Loaded the highlighted text from the active page." : "No text is highlighted on the active page."
    })

  const previewTypography = () =>
    run("Typography preview applied", async () => {
      const response = await sendStudioMessage<StudioResponse>({
        type: "PAGE_STUDIO_APPLY_TEXT",
        fontFamily: fontStack,
        color: textColor,
        backgroundColor: textBackground,
        fontSize: `${fontSize}px`,
        fontWeight: String(fontWeight),
        letterSpacing: `${letterSpacing}px`
      })
      if (response.text) setSelection(response.text)
      return `Previewing typography on ${response.count || 1} text selection${response.count === 1 ? "" : "s"}.`
    })

  const pickElement = () =>
    run("Element picker armed", async () => {
      await sendStudioMessage({ type: "PAGE_STUDIO_PICK_ELEMENT" })
      return "Click any element on the page to select it for color edits or removal."
    })

  const applyElementColors = () =>
    run("Element colors applied", async () => {
      const response = await sendStudioMessage<StudioResponse>({
        type: "PAGE_STUDIO_APPLY_ELEMENT_STYLE",
        color: elementColor,
        backgroundColor: elementBackground,
        outlineColor: elementOutline
      })
      return `Applied colors to ${response.label || response.tagName || "the selected element"}.`
    })

  const removeElement = () =>
    run("Element removed", async () => {
      const response = await sendStudioMessage<StudioResponse>({ type: "PAGE_STUDIO_REMOVE_SELECTED" })
      return `Removed ${response.label || response.tagName || "the selected element"} from the preview.`
    })

  const startMarkup = () =>
    run("Markup armed", async () => {
      await sendStudioMessage({
        type: "PAGE_STUDIO_START_MARKUP",
        tool: markupTool,
        color: markupColor,
        text: noteText
      })
      return markupTool === "note"
        ? "Click the page where the note should land."
        : "Drag on the page to draw the annotation."
    })

  const stopMarkup = () =>
    run("Markup stopped", async () => {
      await sendStudioMessage({ type: "PAGE_STUDIO_STOP_MARKUP" })
      return "Stopped markup capture."
    })

  const clearPageStudio = () =>
    run("Page Studio reset", async () => {
      await sendStudioMessage({ type: "PAGE_STUDIO_CLEAR" })
      setLastCapture(null)
      return "Cleared Page Studio edits from the active page."
    })

  const downloadScreenshot = () =>
    run("Screenshot downloaded", async () => {
      const dataUrl = await captureVisiblePng()
      setLastCapture(dataUrl)
      const a = document.createElement("a")
      a.href = dataUrl
      a.download = `page-studio-${Date.now()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      return "Downloaded the annotated visible-page screenshot."
    })

  const copyScreenshotImage = () =>
    run("Screenshot copied", async () => {
      const dataUrl = lastCapture || await captureVisiblePng()
      setLastCapture(dataUrl)
      const blob = await (await fetch(dataUrl)).blob()
      const ClipboardItemCtor = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem
      if (!ClipboardItemCtor || !navigator.clipboard?.write) {
        await navigator.clipboard.writeText(dataUrl)
        return "Image clipboard is unavailable, so copied the data URL instead."
      }
      await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type]: blob })])
      return "Copied the annotated screenshot image."
    })

  const copyScreenshotLink = () =>
    run("Screenshot link copied", async () => {
      const dataUrl = lastCapture || await captureVisiblePng()
      setLastCapture(dataUrl)
      await navigator.clipboard.writeText(dataUrl)
      return "Copied a data URL for the annotated screenshot."
    })

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden bg-bg text-fg" data-testid="page-studio-section">
      <header className="border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">Page Studio</h1>
            <p className="truncate text-[11px] text-fg/45">Try type, color, removals, and markup on live pages</p>
          </div>
          <button
            type="button"
            onClick={() => void clearPageStudio()}
            disabled={busy}
            className="rounded-full border border-border px-2 py-1 text-[10px] text-fg/55 hover:bg-accent disabled:opacity-50"
          >
            Reset
          </button>
        </div>
      </header>

      <div className="grid grid-cols-3 gap-1 border-b border-border bg-card/20 p-1.5 text-[11px]">
        {([
          ["type", "Type Lab"],
          ["elements", "Elements"],
          ["markup", "Markup"]
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPage(id)}
            className={`rounded-lg px-2 py-1.5 transition-colors ${
              page === id ? "bg-accent text-fg" : "text-fg/45 hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {status && (
        <PretextTextBlock
          text={status}
          verticalPadding={16}
          className="border-b border-border bg-primary/10 px-3 py-2 text-[11px] leading-5 text-primary"
        >
          {status}
        </PretextTextBlock>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {page === "type" && (
          <div className="grid gap-3">
            <section className="rounded-xl border border-border bg-card/35 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold">Highlighted text</div>
                  <div className="text-[10px] text-fg/40">Highlight text in the page first</div>
                </div>
                <button
                  type="button"
                  onClick={() => void loadSelection()}
                  disabled={busy}
                  className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-bg disabled:opacity-50"
                >
                  Use selection
                </button>
              </div>
              <PretextTextBlock
                text={compactSelection(selection)}
                className="rounded-lg border border-border/60 bg-bg/60 p-2 text-[11px] leading-5 text-fg/60"
              >
                {compactSelection(selection)}
              </PretextTextBlock>
            </section>

            <section className="rounded-xl border border-border bg-card/35 p-3">
              <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wide text-fg/45">
                Font type
              </label>
              <div className="mb-2 grid grid-cols-3 gap-1">
                {(Object.keys(FONT_KIND_LABELS) as Array<FontKind | "all">).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setFontKind(kind)}
                    className={`rounded-md border border-border px-2 py-1 text-[10px] ${
                      fontKind === kind ? "bg-accent text-fg" : "bg-bg/40 text-fg/45 hover:text-fg"
                    }`}
                  >
                    {FONT_KIND_LABELS[kind]}
                  </button>
                ))}
              </div>
              <select
                value={fontStack}
                onChange={(event) => setFontStack(event.target.value)}
                className="w-full rounded-lg border border-border bg-input px-2 py-2 text-xs text-fg outline-none focus:border-primary/60"
              >
                {filteredFonts.map((font) => (
                  <option key={font.stack} value={font.stack}>
                    {font.label}
                  </option>
                ))}
              </select>
              <div
                className="mt-3 rounded-lg border border-border/60 bg-bg p-3 text-lg"
                style={{ fontFamily: fontStack, color: textColor, backgroundColor: textBackground }}
              >
                The quick redesign fox jumps over production constraints.
              </div>
            </section>

            <section className="grid gap-3 rounded-xl border border-border bg-card/35 p-3">
              <ControlRow label={`Size ${fontSize}px`}>
                <input type="range" min={10} max={64} value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} />
              </ControlRow>
              <ControlRow label={`Weight ${fontWeight}`}>
                <input type="range" min={100} max={900} step={100} value={fontWeight} onChange={(event) => setFontWeight(Number(event.target.value))} />
              </ControlRow>
              <ControlRow label={`Tracking ${letterSpacing}px`}>
                <input type="range" min={-2} max={8} step={0.5} value={letterSpacing} onChange={(event) => setLetterSpacing(Number(event.target.value))} />
              </ControlRow>
              <ColorRow label="Text color" value={textColor} onChange={setTextColor} />
              <ColorRow label="Highlight" value={textBackground} onChange={setTextBackground} />
              <button
                type="button"
                onClick={() => void previewTypography()}
                disabled={busy}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-bg disabled:opacity-50"
              >
                Preview on highlighted text
              </button>
            </section>
          </div>
        )}

        {page === "elements" && (
          <div className="grid gap-3">
            <section className="rounded-xl border border-border bg-card/35 p-3">
              <div className="mb-2 text-xs font-semibold">Element edits</div>
              <PretextTextBlock
                text="Pick an element on the page, then change its text, background, or outline color. Remove hides the element for the current preview only."
                className="mb-3 text-[11px] leading-5 text-fg/55"
              >
                Pick an element on the page, then change its text, background, or outline color.
                Remove hides the element for the current preview only.
              </PretextTextBlock>
              <button
                type="button"
                onClick={() => void pickElement()}
                disabled={busy}
                className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-bg disabled:opacity-50"
              >
                <LeoIcon name="search" size={14} />
                Pick element on page
              </button>
              <div className="grid gap-2">
                <ColorRow label="Text" value={elementColor} onChange={setElementColor} />
                <ColorRow label="Background" value={elementBackground} onChange={setElementBackground} />
                <ColorRow label="Outline" value={elementOutline} onChange={setElementOutline} />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void applyElementColors()}
                  disabled={busy}
                  className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-fg/75 hover:bg-accent disabled:opacity-50"
                >
                  Apply colors
                </button>
                <button
                  type="button"
                  onClick={() => void removeElement()}
                  disabled={busy}
                  className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error hover:bg-error/20 disabled:opacity-50"
                >
                  Remove element
                </button>
              </div>
            </section>
          </div>
        )}

        {page === "markup" && (
          <div className="grid gap-3">
            <section className="rounded-xl border border-border bg-card/35 p-3">
              <div className="mb-2 text-xs font-semibold">Markup the current page</div>
              <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg border border-border/70 bg-bg/60 p-1 text-[11px]">
                {(["highlight", "box", "note"] as MarkupTool[]).map((tool) => (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => setMarkupTool(tool)}
                    className={`rounded-md px-2 py-1.5 capitalize transition-colors ${
                      markupTool === tool ? "bg-accent text-fg" : "text-fg/45 hover:text-fg"
                    }`}
                  >
                    {tool}
                  </button>
                ))}
              </div>
              <ColorRow label="Markup color" value={markupColor} onChange={setMarkupColor} />
              {markupTool === "note" && (
                <textarea
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                  className="mt-2 min-h-[70px] w-full resize-none rounded-lg border border-border bg-input px-2 py-2 text-xs text-fg outline-none focus:border-primary/60"
                  placeholder="Annotation text"
                />
              )}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => void startMarkup()}
                  disabled={busy}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-bg disabled:opacity-50"
                >
                  Start markup
                </button>
                <button
                  type="button"
                  onClick={() => void stopMarkup()}
                  disabled={busy}
                  className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-fg/70 hover:bg-accent disabled:opacity-50"
                >
                  Stop
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card/35 p-3">
              <div className="mb-2 text-xs font-semibold">Export for LLM review</div>
              <div className="grid gap-2">
                <button
                  type="button"
                  onClick={() => void downloadScreenshot()}
                  disabled={busy}
                  className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-fg/75 hover:bg-accent disabled:opacity-50"
                >
                  Download annotated screenshot
                </button>
                <button
                  type="button"
                  onClick={() => void copyScreenshotImage()}
                  disabled={busy}
                  className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-fg/75 hover:bg-accent disabled:opacity-50"
                >
                  Copy screenshot image
                </button>
                <button
                  type="button"
                  onClick={() => void copyScreenshotLink()}
                  disabled={busy}
                  className="rounded-lg border border-border bg-card/50 px-3 py-2 text-xs text-fg/75 hover:bg-accent disabled:opacity-50"
                >
                  Copy screenshot data URL
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </section>
  )
}

function ControlRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-[11px] text-fg/55">
      <span>{label}</span>
      {children}
    </label>
  )
}

function ColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (next: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-[11px] text-fg/55">
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-7 w-9 rounded border border-border bg-transparent"
        />
        <input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-24 rounded border border-border bg-input px-2 py-1 text-[11px] text-fg outline-none focus:border-primary/60"
        />
      </span>
    </label>
  )
}
