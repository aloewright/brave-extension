/**
 * Multi-frame Picture-in-Picture coordinator.
 *
 * The PiP content script (`src/contents/pip.ts`) runs in every frame
 * (`all_frames: true`), but each instance only sees its own document. To
 * PiP a video inside a cross-origin iframe (e.g. YouTube embedded in a
 * blog post), we have to message the right frame directly via
 * `chrome.tabs.sendMessage(..., { frameId })`.
 *
 * `triggerPipInTab(tabId)` tries the top frame first — that's where the
 * video lives 95% of the time, and it short-circuits the
 * `chrome.webNavigation.getAllFrames` round-trip. Only when the top frame
 * specifically reports "no video" do we fall back to iframes. Other
 * top-frame errors (e.g. "Document is not allowed to use Picture-in-
 * Picture") are propagated verbatim so the user sees the real failure.
 *
 * Iframe attempts are sequential, not parallel: there's only one PiP
 * slot per tab, and racing N requests against it will mostly produce
 * NotAllowedError noise. First success wins.
 *
 * This function never throws. All errors flow through the PiPResult
 * shape, including missing webNavigation permission and missing content
 * scripts in some frames.
 */

import {
  PIP_NO_CONTENT_SCRIPT_REASON,
  PIP_NO_VIDEO_REASON,
  PIP_TOGGLE_MESSAGE,
  type PiPResult
} from "./protocol"

export type { PiPResult } from "./protocol"

// Chrome's webNavigation/tabs APIs use frameId 0 for the main document
// of a tab. Iframes get monotonically-assigned non-zero IDs. Naming the
// constant keeps the top-frame intent obvious at every call site.
const TOP_FRAME_ID = 0

/**
 * Wraps `chrome.tabs.sendMessage` in a promise that consumes
 * `chrome.runtime.lastError`. A frame might not have the content script
 * (e.g. the page never loaded it, or it's a privileged URL) — in that
 * case we return a synthetic "no content script" result instead of
 * leaving an unhandled lastError on the runtime.
 */
function sendToFrame(tabId: number, frameId: number): Promise<PiPResult> {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: PIP_TOGGLE_MESSAGE },
        { frameId },
        (response: PiPResult | undefined) => {
          // Always read lastError to defuse the runtime warning.
          const err = chrome.runtime.lastError
          if (err || !response) {
            resolve({
              ok: false,
              action: "none",
              reason: PIP_NO_CONTENT_SCRIPT_REASON
            })
            return
          }
          resolve(response)
        }
      )
    } catch {
      // sendMessage can synchronously throw if the API itself is
      // unavailable. Treat the same as a missing content script.
      resolve({
        ok: false,
        action: "none",
        reason: PIP_NO_CONTENT_SCRIPT_REASON
      })
    }
  })
}

/**
 * Wraps `chrome.webNavigation.getAllFrames` in a promise that swallows
 * permission/runtime errors. If the API isn't available (permission not
 * granted yet, restricted URL, etc.) we return an empty list — the
 * caller will fall back to whatever the top frame reported.
 */
function getAllFrames(
  tabId: number
): Promise<chrome.webNavigation.GetAllFrameResultDetails[]> {
  return new Promise((resolve) => {
    try {
      if (!chrome.webNavigation?.getAllFrames) {
        // Surface this once per call: the iframe fallback path is a
        // no-op until the controller's permission-add commit lands.
        // Without this warning, the user just sees "no video" on every
        // page where the video lives in an iframe and there's no clue
        // why the iframe enumeration silently bailed.
        console.warn(
          "[lean-pip] webNavigation permission missing — iframe PiP disabled"
        )
        resolve([])
        return
      }
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        // Read lastError to keep the runtime quiet.
        void chrome.runtime.lastError
        resolve(frames ?? [])
      })
    } catch {
      resolve([])
    }
  })
}

export async function triggerPipInTab(tabId: number): Promise<PiPResult> {
  // 1. Try the top frame. This is the common path and avoids the cost
  //    of a webNavigation round-trip when the video is in the main
  //    document.
  const top = await sendToFrame(tabId, TOP_FRAME_ID)

  // 2. Top-frame succeeded (entered or exited). Done.
  if (top.ok) {
    return { ...top, frameId: TOP_FRAME_ID }
  }

  // 3. Top-frame failed for a reason *other* than "no video" — that's
  //    a real error the user should see (e.g. "Document is not allowed
  //    to use Picture-in-Picture"). Don't paper over it with iframe
  //    fallback; the iframes almost certainly aren't the right target.
  if (top.reason !== PIP_NO_VIDEO_REASON) {
    return { ...top, frameId: TOP_FRAME_ID }
  }

  // 4. Top-frame had no video. Enumerate iframes and try each one
  //    sequentially. Skip the top frame (already tried) and any frames
  //    that errored out at navigation time.
  const frames = await getAllFrames(tabId)
  const iframes = frames.filter(
    (f) => f.frameId !== TOP_FRAME_ID && !f.errorOccurred
  )

  for (const frame of iframes) {
    const result = await sendToFrame(tabId, frame.frameId)
    if (result.ok) {
      return { ...result, frameId: frame.frameId }
    }
    // On failure, just continue — we want the first frame that has a
    // video and can PiP it.
  }

  // 5. No iframe had a video either. Return the original top-frame
  //    "no video" response so the UI shows the canonical message.
  return { ...top, frameId: TOP_FRAME_ID }
}
