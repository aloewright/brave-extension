import { useEffect, useState } from "react"
import { LeoButton, LeoIconButton } from "../../components/leo"
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
import {
  captureErrorMessage,
  captureVisibleOrPromptedScreenshot
} from "../../lib/screenshot-capture"
import { getSettings } from "../../storage"
import {
  describeCaptureDestination,
  resolveCaptureDestination,
  type CaptureKind
} from "../../lib/capture-destination"
import {
  CaptureUploadError,
  dataUrlToBlob,
  uploadCapture
} from "../../lib/capture-upload"

type SectionId = "library" | "recorder"

interface Props {
  onNavigate?: (section: SectionId) => void
}

interface DispatchCaptureArgs {
  kind: CaptureKind
  baseFilename: string
  dataUrl?: string
  blob?: Blob
  pageUrl?: string
  pageTitle?: string
  sourceLabel?: string | null
  flash: (msg: string) => void
}

/**
 * Honor the user's capture save-location preference (ALO-467). For
 * "downloads" / "downloads-subfolder" we hand off to chrome.downloads with
 * the resolver's filename. For "cloud" we POST to the sidebar-api Worker;
 * if the upload fails or the cloud destination isn't fully configured the
 * resolver already routed us back to downloads with a `fallbackReason`.
 *
 * Errors surface via `flash()` so the user knows when a configured
 * destination is unavailable.
 */
async function dispatchCapture(args: DispatchCaptureArgs): Promise<void> {
  const { kind, baseFilename, dataUrl, blob, pageUrl, pageTitle, flash } = args
  const settings = await getSettings()
  const { destination, fallbackReason } = resolveCaptureDestination(baseFilename, settings)
  if (fallbackReason === "cloud-disabled") {
    flash("Cloud captures disabled — saving to Downloads")
  } else if (fallbackReason === "cloud-not-configured") {
    flash("Sidebar API not configured — saving to Downloads")
  }

  if (destination.kind === "cloud") {
    try {
      let body: Blob | ArrayBuffer
      if (blob) {
        body = blob
      } else if (dataUrl) {
        body = await dataUrlToBlob(dataUrl)
      } else {
        throw new Error("no capture body")
      }
      const uploaded = await uploadCapture({
        apiUrl: destination.apiUrl,
        apiToken: destination.apiToken,
        filename: destination.filename,
        kind,
        pageUrl,
        pageTitle,
        body
      })
      flash(args.sourceLabel ?? `Uploaded ${uploaded.filename}`)
      return
    } catch (err) {
      const msg =
        err instanceof CaptureUploadError
          ? `Cloud upload failed (${err.status}); saving locally instead`
          : `Cloud upload failed: ${err instanceof Error ? err.message : String(err)}`
      flash(msg)
      // Fall through to local downloads as a graceful recovery.
    }
  }

  // Downloads path — works for both "downloads" and "downloads-subfolder",
  // and for cloud failures above.
  const filename =
    destination.kind === "downloads"
      ? destination.filename
      : destination.filename
  if (dataUrl) {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false })
  } else if (blob) {
    const url = URL.createObjectURL(blob)
    try {
      await chrome.downloads.download({ url, filename, saveAs: false })
    } finally {
      setTimeout(() => {
        try { URL.revokeObjectURL(url) } catch { /* ignore */ }
      }, 60_000)
    }
  }
  flash(args.sourceLabel ?? describeCaptureDestination(destination))
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
      const result = await captureVisibleOrPromptedScreenshot(win.id, {
        onFallback: () => flash("Choose tab/window to capture")
      })
      const baseName = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
      await dispatchCapture({
        kind: "screenshot",
        baseFilename: baseName,
        dataUrl: result.dataUrl,
        pageUrl: tab?.url,
        pageTitle: tab?.title,
        sourceLabel: result.source === "display-picker" ? "Screenshot saved from picker" : null,
        flash
      })
    } catch (err) {
      flash(`Screenshot failed: ${captureErrorMessage(err)}`)
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
      const baseName = `${(tab.title || "page").replace(/[^\w.-]+/g, "_")}.pdf`
      await dispatchCapture({
        kind: "pdf",
        baseFilename: baseName,
        blob,
        pageUrl: tab.url,
        pageTitle: tab.title,
        flash
      })
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
        <LeoIconButton
          onClick={() => onNavigate?.("recorder")}
          title="Open recorder"
          aria-label="Open recorder"
          className="text-fg/60 hover:text-fg"
          icon="radio-checked"
          iconSize={14}
          variant="ghost"
        />
        <LeoIconButton
          onClick={onPip}
          title="Picture-in-picture"
          aria-label="Picture-in-picture"
          className="text-fg/60 hover:text-fg"
          icon="picture-in-picture"
          iconSize={14}
          variant="ghost"
        />
        <LeoButton
          onClick={onAutoToggle}
          title="Auto Picture-in-picture when you switch tabs"
          active={autoPip}
          className="font-mono text-[9px] uppercase"
          size="xs"
          variant={autoPip ? "primary" : "ghost"}>
          Auto
        </LeoButton>
        <LeoIconButton
          onClick={onSaveLink}
          title="Save link"
          aria-label="Save link"
          className="text-fg/60 hover:text-fg"
          icon="link-normal"
          iconSize={14}
          variant="ghost"
        />
        <LeoIconButton
          onClick={onSavePage}
          title="Save page to Library"
          aria-label="Save page to Library"
          className="text-fg/60 hover:text-fg"
          icon="product-bookmarks"
          iconSize={14}
          variant="ghost"
        />
        <LeoIconButton
          onClick={onScreenshot}
          title="Screenshot visible area"
          aria-label="Screenshot visible area"
          className="text-fg/60 hover:text-fg"
          icon="screenshot"
          iconSize={14}
          variant="ghost"
        />
        <LeoIconButton
          onClick={onPdf}
          title="Save as PDF"
          aria-label="Save as PDF"
          className="text-fg/60 hover:text-fg"
          icon="file-export"
          iconSize={14}
          variant="ghost"
        />
        <LeoIconButton
          onClick={() => onNavigate?.("library")}
          title="Open Library"
          aria-label="Open Library"
          className="text-fg/60 hover:text-fg"
          icon="inbox"
          iconSize={14}
          variant="ghost"
        />
      </div>

      {info.activePanel === "network" && (
        <NetworkPanel userIp={info.userIp} siteIp={info.siteIp} onCopy={copyAndToast} />
      )}
      {info.activePanel === "tech" && <TechPanel techs={info.techs} />}
      {info.activePanel === "rss" && <RssPanel feeds={info.feeds} onCopy={copyAndToast} />}
    </div>
  )
}
