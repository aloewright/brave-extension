/**
 * Quick-action helpers shared by the sidebar rail (bottom group, ALO-471)
 * and any legacy mountings still using them. Pulled out of QuickActionsBar
 * so the rail can call them without re-rendering the full bar.
 *
 * Each helper returns a tagged result the caller renders as a toast.
 */
import {
  captureErrorMessage,
  captureVisibleOrPromptedScreenshot
} from "./screenshot-capture"
import { triggerPipInTab } from "./pip/coord"
import { PIP_NO_CONTENT_SCRIPT_REASON } from "./pip/protocol"
import { getSettings } from "../storage"
import {
  describeCaptureDestination,
  resolveCaptureDestination
} from "./capture-destination"
import {
  CaptureUploadError,
  dataUrlToBlob,
  uploadCapture
} from "./capture-upload"
import { suggestMediaFilename } from "./ai-rename"
import { base64ToBytes, captureFullPagePdf } from "./pdf-capture"
import type { ScrapeResult } from "../types"

export type QuickActionResult =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }

const PDF_MIME_TYPE = "application/pdf"
const DOWNLOAD_URL_REVOKE_DELAY_MS = 30_000

function pdfBase64ToBlob(base64: string): Blob {
  const bytes = base64ToBytes(base64)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return new Blob([buffer], { type: PDF_MIME_TYPE })
}

async function downloadPdfBase64(base64: string, filename: string): Promise<void> {
  const dataUrl = `data:${PDF_MIME_TYPE};base64,${base64}`
  if (typeof URL.createObjectURL !== "function") {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false })
    return
  }

  const url = URL.createObjectURL(pdfBase64ToBlob(base64))
  try {
    await chrome.downloads.download({ url, filename, saveAs: false })
  } catch {
    await chrome.downloads.download({ url: dataUrl, filename, saveAs: false })
  } finally {
    if (typeof URL.revokeObjectURL === "function") {
      setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS)
    }
  }
}

/**
 * Capture the visible tab (or, when activeTab isn't available, prompt the
 * user to pick a window/tab). Routes through the configured capture
 * destination (Downloads / Downloads subfolder / Cloud).
 */
export async function runScreenshotQuickAction(): Promise<QuickActionResult> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const result = await captureVisibleOrPromptedScreenshot(win.id, {})
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    const baseFilename = `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
    const settings = await getSettings()
    const filename = await suggestMediaFilename({
      settings,
      fallbackFilename: baseFilename,
      mediaKind: "image",
      mimeType: "image/png",
      sourceUrl: tab?.url,
      sourceTitle: tab?.title,
      createdAt: new Date().toISOString()
    })
    const { destination, fallbackReason } = resolveCaptureDestination(filename, settings)

    if (destination.kind === "cloud") {
      try {
        const body = await dataUrlToBlob(result.dataUrl)
        const uploaded = await uploadCapture({
          apiUrl: destination.apiUrl,
          apiToken: destination.apiToken,
          filename: destination.filename,
          kind: "screenshot",
          pageUrl: tab?.url,
          pageTitle: tab?.title,
          body
        })
        return { kind: "success", message: `Uploaded ${uploaded.filename}` }
      } catch (err) {
        const msg =
          err instanceof CaptureUploadError
            ? `Cloud upload failed (${err.status}); saving locally instead`
            : `Cloud upload failed: ${err instanceof Error ? err.message : String(err)}`
        await chrome.downloads.download({
          url: result.dataUrl,
          filename,
          saveAs: false
        })
        return { kind: "error", message: msg }
      }
    }

    await chrome.downloads.download({
      url: result.dataUrl,
      filename: destination.filename,
      saveAs: false
    })
    const prefix =
      fallbackReason === "cloud-disabled"
        ? "Cloud disabled — "
        : fallbackReason === "cloud-not-configured"
          ? "Sidebar API not configured — "
          : ""
    return { kind: "success", message: prefix + describeCaptureDestination(destination) }
  } catch (err) {
    return { kind: "error", message: `Screenshot failed: ${captureErrorMessage(err)}` }
  }
}

/**
 * Capture the active tab as a full-page PDF and route it through the configured
 * capture destination (Downloads / subfolder / Cloud). Cloud uploads use
 * kind="pdf"; the worker OCRs and auto-renames it at ingest.
 */
export async function runFullPagePdfQuickAction(): Promise<QuickActionResult> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    if (!tab?.id) return { kind: "error", message: "No active tab to capture" }

    const base64 = await captureFullPagePdf(tab.id)
    const baseFilename = `page-${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`
    const settings = await getSettings()
    const { destination, fallbackReason } = resolveCaptureDestination(baseFilename, settings)

    if (destination.kind === "cloud") {
      try {
        const body = pdfBase64ToBlob(base64)
        const uploaded = await uploadCapture({
          apiUrl: destination.apiUrl,
          apiToken: destination.apiToken,
          filename: destination.filename,
          kind: "pdf",
          contentType: "application/pdf",
          pageUrl: tab.url,
          pageTitle: tab.title,
          body
        })
        return { kind: "success", message: `Uploaded ${uploaded.filename}` }
      } catch (err) {
        const msg =
          err instanceof CaptureUploadError
            ? `Cloud upload failed (${err.status}); saving locally instead`
            : `Cloud upload failed: ${err instanceof Error ? err.message : String(err)}`
        await downloadPdfBase64(base64, baseFilename)
        return { kind: "error", message: msg }
      }
    }

    await downloadPdfBase64(base64, destination.filename)
    const prefix =
      fallbackReason === "cloud-disabled"
        ? "Cloud disabled — "
        : fallbackReason === "cloud-not-configured"
          ? "Sidebar API not configured — "
          : ""
    return { kind: "success", message: prefix + describeCaptureDestination(destination) }
  } catch (err) {
    return { kind: "error", message: `Full-page PDF failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * Toggle Picture-in-Picture on the active tab's first viable <video>.
 */
export async function runPipQuickAction(): Promise<QuickActionResult> {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
  if (!tab?.id) return { kind: "error", message: "No active tab" }
  const res = await triggerPipInTab(tab.id)
  if (res.ok) {
    return {
      kind: "success",
      message: res.action === "exited" ? "Exited PiP" : "Picture-in-picture"
    }
  }
  return {
    kind: "error",
    message: res.reason === PIP_NO_CONTENT_SCRIPT_REASON ? "Reload page first" : res.reason || "PiP failed"
  }
}

/**
 * Persist the active tab as a Session link (the old "save link" action
 * pre-rename — ALO-470 renamed library → session). Sends SAVE_LINK and
 * resolves on ack.
 */
export async function runSaveLinkQuickAction(): Promise<QuickActionResult> {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
  if (!tab?.url || !tab?.title) return { kind: "error", message: "No active tab" }
  return new Promise<QuickActionResult>((resolve) => {
    chrome.runtime.sendMessage(
      { type: "SAVE_LINK", url: tab.url, title: tab.title },
      () => resolve({ kind: "success", message: "Link saved" })
    )
  })
}

/**
 * Ask the background service worker to scrape the active page. The background
 * owns persistence, sidebar broadcasts, and optional Worker sync so the context
 * menu and quick action stay behaviorally identical.
 */
export async function runScrapeCurrentPageQuickAction(): Promise<QuickActionResult> {
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
    if (!tab?.id || !tab.url) return { kind: "error", message: "No active tab" }
    if (/^(chrome|chrome-extension|about|edge|brave):\/\//.test(tab.url)) {
      return { kind: "error", message: "Cannot scrape browser-internal pages" }
    }

    const result = await new Promise<ScrapeResult | { error: string } | null>((resolve) => {
      chrome.runtime.sendMessage({ type: "SCRAPE_TAB", tabId: tab.id }, (response) => {
        const err = chrome.runtime.lastError
        if (err) {
          resolve({ error: err.message || "scrape failed" })
          return
        }
        resolve(response ?? null)
      })
    })

    if (!result) return { kind: "error", message: "Scrape returned no content" }
    if ("error" in result) return { kind: "error", message: result.error }
    const words = result.text.trim() ? result.text.trim().split(/\s+/).length : 0
    return { kind: "success", message: `Scraped ${words.toLocaleString()} words` }
  } catch (err) {
    return { kind: "error", message: `Scrape failed: ${err instanceof Error ? err.message : String(err)}` }
  }
}
