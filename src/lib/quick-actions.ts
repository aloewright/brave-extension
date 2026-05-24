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

export type QuickActionResult =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string }

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
    const { destination, fallbackReason } = resolveCaptureDestination(baseFilename, settings)

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
          filename: baseFilename,
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
 * Ask the active page-agent content script to toggle its popout.
 */
export async function runPageAgentQuickAction(): Promise<QuickActionResult> {
  const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
  if (!tab?.id) return { kind: "error", message: "No active tab" }
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "PAGE_AGENT_TOGGLE" }) as
      | { ok?: boolean; open?: boolean }
      | undefined
    if (res?.ok) {
      return { kind: "success", message: res.open ? "Page agent shown" : "Page agent hidden" }
    }
    return { kind: "error", message: "Page agent unavailable" }
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : "Page agent unavailable"
    }
  }
}
