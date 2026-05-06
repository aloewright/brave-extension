import { useEffect, useState } from "react"
import {
  NetworkButton,
  NetworkPanel,
  RssButton,
  RssPanel,
  TechButton,
  TechPanel,
  useInfoPanels
} from "../_lx/components/InfoPanels"
import { triggerPipInTab } from "../../lib/pip/coord"
import { getAutoPipEnabled, setAutoPipEnabled } from "../../lib/pip/auto"
import { PIP_NO_CONTENT_SCRIPT_REASON } from "../../lib/pip/protocol"

type SectionId = "library" | "recorder"

interface Props {
  onNavigate?: (section: SectionId) => void
}

/**
 * Top-of-section icon row mirroring the lean-extensions popup header.
 * Globe / Lock / RSS toggle info panels; PiP, AUTO, save-link, screenshot,
 * PDF and the "save page" / "library" shortcuts run their respective actions.
 */
export function QuickActionsBar({ onNavigate }: Props) {
  const info = useInfoPanels()
  const [autoPip, setAutoPip] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    void getAutoPipEnabled().then(setAutoPip)
  }, [])

  const flash = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2000)
  }

  const copyAndToast = (text: string, label: string) => {
    void navigator.clipboard.writeText(text).then(
      () => flash(label),
      () => flash("Copy failed")
    )
  }

  const onPip = async () => {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    if (!tab?.id) return flash("No active tab")
    const res = await triggerPipInTab(tab.id)
    if (res.ok) flash(res.action === "exited" ? "Exited PiP" : "Picture-in-picture")
    else flash(res.reason === PIP_NO_CONTENT_SCRIPT_REASON ? "Reload page first" : res.reason || "PiP failed")
  }

  const onAutoToggle = async () => {
    const next = !autoPip
    setAutoPip(next)
    await setAutoPipEnabled(next)
    flash(next ? "Auto-PiP on" : "Auto-PiP off")
  }

  const onSaveLink = async () => {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    if (!tab?.url || !tab?.title) return flash("No active tab")
    chrome.runtime.sendMessage({ type: "SAVE_LINK", url: tab.url, title: tab.title }, () => flash("Link saved"))
  }

  const onScreenshot = async () => {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: "png" })
      const filename = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
      await chrome.downloads.download({ url: dataUrl, filename, saveAs: false })
      flash("Screenshot saved")
    } catch (err) {
      flash(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const onPdf = async () => {
    // chrome.tabs.printToPDF lives behind a flag in stable builds; fall back to
    // chrome.tabs.create("about:blank") + window.print equivalent if missing.
    const printToPDF = (chrome.tabs as any).printToPDF as
      | ((opts: any, cb: (data: ArrayBuffer) => void) => void)
      | undefined
    if (!printToPDF) {
      flash("PDF not supported in this Chrome build")
      return
    }
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    if (!tab?.id) return flash("No active tab")
    flash("Generating PDF…")
    printToPDF.call(chrome.tabs, { tabId: tab.id }, async (data: ArrayBuffer) => {
      const blob = new Blob([data], { type: "application/pdf" })
      const url = URL.createObjectURL(blob)
      const filename = `${(tab.title || "page").replace(/[^\w.-]+/g, "_")}.pdf`
      await chrome.downloads.download({ url, filename, saveAs: false })
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      flash("PDF saved")
    })
  }

  const onSavePage = async () => {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    if (!tab?.url || !tab?.title) return flash("No active tab")
    chrome.runtime.sendMessage({ type: "SAVE_LINK", url: tab.url, title: tab.title }, () => {
      flash("Saved to Library")
      onNavigate?.("library")
    })
  }

  return (
    <div className="border-b border-border">
      {toast && (
        <div className="px-3 py-1 text-[11px] text-success bg-success/10">{toast}</div>
      )}
      <div className="px-2 py-1.5 flex items-center gap-1 justify-end overflow-x-auto">
        <NetworkButton
          active={info.activePanel === "network"}
          hasData={!!info.userIp}
          onClick={() => info.toggle("network")}
        />
        <TechButton
          active={info.activePanel === "tech"}
          count={info.techs.length}
          onClick={() => info.toggle("tech")}
        />
        <RssButton
          active={info.activePanel === "rss"}
          count={info.feeds.length}
          onClick={() => info.toggle("rss")}
        />
        <button
          onClick={() => onNavigate?.("recorder")}
          title="Open recorder"
          className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="3" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={onPip}
          title="Picture-in-picture"
          className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="4" width="20" height="14" rx="2" />
            <rect x="13" y="11" width="8" height="6" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={onAutoToggle}
          title="Auto Picture-in-picture when you switch tabs"
          className={`px-1.5 py-1 text-[9px] font-mono uppercase tracking-wider rounded transition-colors ${
            autoPip
              ? "bg-info/20 text-info ring-1 ring-info/40"
              : "text-fg/30 hover:text-fg/60 hover:bg-accent"
          }`}>
          Auto
        </button>
        <button
          onClick={onSaveLink}
          title="Save link"
          className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
        <button
          onClick={onSavePage}
          title="Save page to Library"
          className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
          </svg>
        </button>
        <button
          onClick={onScreenshot}
          title="Screenshot visible area"
          className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </button>
        <button
          onClick={onPdf}
          title="Save as PDF"
          className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
        </button>
        <button
          onClick={() => onNavigate?.("library")}
          title="Open Library"
          className="p-1.5 rounded hover:bg-accent text-fg/60 hover:text-fg transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        </button>
      </div>

      {info.activePanel === "network" && (
        <NetworkPanel userIp={info.userIp} siteIp={info.siteIp} onCopy={copyAndToast} />
      )}
      {info.activePanel === "tech" && <TechPanel techs={info.techs} />}
      {info.activePanel === "rss" && <RssPanel feeds={info.feeds} onCopy={copyAndToast} />}
    </div>
  )
}
