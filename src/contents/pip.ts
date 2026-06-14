import {
  getAutoPipEnabled,
  PIP_AUTO_CHANGED_MESSAGE,
  type PiPAutoChangedMessage
} from "../lib/pip/auto"
import {
  PIP_EXIT_MESSAGE,
  PIP_NO_VIDEO_REASON,
  PIP_TOGGLE_MESSAGE,
  type PiPResult
} from "../lib/pip/protocol"

/**
 * Picture-in-Picture content script.
 *
 * Triggered by the popup button or the Alt+Shift+P command. Picks the best
 * candidate `<video>` on the page (currently playing > largest visible >
 * first found), strips any `disablePictureInPicture` attribute the site
 * has set, and toggles PiP. If the page is already in PiP, exits.
 *
 * Runs in every frame (top + iframes). The popup/background coordinator
 * in src/utils/pip-coord.ts is responsible for picking which frame to
 * target — typically top frame first, then iframes via webNavigation.
 * Each frame only sees its own document.querySelectorAll('video') results,
 * so embedded YouTube/Vimeo/etc. inside a third-party page is reachable
 * from the iframe's own copy of this script.
 */

function pickBestVideo(): HTMLVideoElement | null {
  const all = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[]
  if (all.length === 0) return null

  // 1. A video that's currently playing wins — that's almost certainly
  //    the one the user is paying attention to.
  const playing = all.find((v) => !v.paused && !v.ended && v.readyState >= 2)
  if (playing) return playing

  // 2. Otherwise, the largest visible video.
  let best: HTMLVideoElement | null = null
  let bestArea = 0
  for (const v of all) {
    const r = v.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) continue
    const area = r.width * r.height
    if (area > bestArea) {
      bestArea = area
      best = v
    }
  }
  if (best) return best

  // 3. Fall back to the first one in the DOM, even if it's not visible —
  //    audio-only or off-screen players still PiP fine.
  return all[0]
}

async function togglePiP(): Promise<PiPResult> {
  // Already in PiP? Exit. This makes the same toggle work as a "close PiP"
  // button when it's already open.
  if (document.pictureInPictureElement) {
    try {
      await document.exitPictureInPicture()
      return { ok: true, action: "exited" }
    } catch (err) {
      return { ok: false, action: "none", reason: (err as Error).message }
    }
  }

  if (!document.pictureInPictureEnabled) {
    return { ok: false, action: "none", reason: "PiP is disabled in this browser" }
  }

  const video = pickBestVideo()
  if (!video) {
    return { ok: false, action: "none", reason: PIP_NO_VIDEO_REASON }
  }

  allowVideoPictureInPicture(video)

  // requestPictureInPicture rejects if the video has no data yet. If we're
  // catching it pre-load (e.g. user clicked the button as the page was
  // loading), wait briefly for HAVE_CURRENT_DATA.
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener("loadeddata", done)
        resolve()
      }
      video.addEventListener("loadeddata", done)
      setTimeout(done, 1500)
    })
  }

  try {
    await video.requestPictureInPicture()
    return { ok: true, action: "entered" }
  } catch (err) {
    const msg = (err as Error).message || "Could not enter PiP"
    // The most common failure is "Document is not allowed to use Picture-in-
    // Picture", which happens when the site has overridden the API in the
    // page's main world. Keep the raw browser message — it's actionable.
    return { ok: false, action: "none", reason: msg }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === PIP_TOGGLE_MESSAGE) {
    togglePiP().then(sendResponse)
    return true // async response
  }
  if (message?.type === PIP_EXIT_MESSAGE) {
    if (!document.pictureInPictureElement) {
      sendResponse({ ok: true, action: "none" } satisfies PiPResult)
      return
    }
    document.exitPictureInPicture().then(
      () => sendResponse({ ok: true, action: "exited" } satisfies PiPResult),
      (err) =>
        sendResponse({
          ok: false,
          action: "none",
          reason: (err as Error).message
        } satisfies PiPResult)
    )
    return true
  }
  if (message?.type === PIP_AUTO_CHANGED_MESSAGE) {
    const next = (message as PiPAutoChangedMessage).enabled === true
    applyAutoPipState(next)
    // No async response needed — fire and forget. Returning falsy
    // tells chrome.runtime to release the message channel immediately.
  }
})

/**
 * Auto-PiP attribute manager (per-frame).
 *
 * The browser's `video.autoPictureInPicture` attribute is what actually
 * triggers Chrome's native auto-PiP on tab/window blur. We just decide
 * which videos to set it on. The MutationObserver catches videos that
 * mount after our initial pass — common on SPAs and infinite-scroll
 * timelines (e.g. Twitter, YouTube). Each frame runs its own copy of
 * this content script (`all_frames: true`), so iframes self-manage.
 *
 * Module-scoped state is fine in a content script: the script lives
 * for the lifetime of the frame's document, no MV3 SW eviction to
 * worry about. On disable we also walk every existing video and clear
 * the attribute, so toggling off takes effect without a reload.
 */

const AUTO_PIP_ATTRIBUTE_SUPPORTED =
  typeof HTMLVideoElement !== "undefined" &&
  "autoPictureInPicture" in HTMLVideoElement.prototype

let autoPipEnabled = false
let autoPipObserver: MutationObserver | null = null
let mediaSessionAutoPipHandlerInstalled = false

// `autoPictureInPicture` isn't in TypeScript's lib.dom yet (still a draft
// WICG spec) — Chrome ships it, we feature-detect it, and this cast keeps
// `tsc --noEmit` quiet without touching tsconfig.
type WithAutoPip = HTMLVideoElement & { autoPictureInPicture?: boolean }

function allowVideoPictureInPicture(video: HTMLVideoElement): void {
  // Some sites set disablePictureInPicture as a hostile move. Strip it.
  if (!video.disablePictureInPicture) return
  try {
    video.disablePictureInPicture = false
    video.removeAttribute("disablepictureinpicture")
  } catch {
    /* read-only on some custom elements — ignore and try anyway */
  }
}

function setAutoPipAttribute(video: HTMLVideoElement, value: boolean): void {
  try {
    ;(video as WithAutoPip).autoPictureInPicture = value
  } catch {
    // Some custom elements (or extension-injected `<video>` shims)
    // mark the property non-writable. Skip silently — there's no
    // user-actionable signal we could surface from a content script.
  }
}

function applyToAllVideos(value: boolean): void {
  if (!AUTO_PIP_ATTRIBUTE_SUPPORTED) return
  // Closed shadow DOMs are intentionally skipped: querySelectorAll
  // can't pierce them, and reaching into closed shadow roots from a
  // content script isn't possible without page-script injection,
  // which isn't worth the complexity for a best-effort feature.
  // Array.from rather than for-of: tsconfig doesn't enable dom.iterable
  // here, and we don't want to flip a global lib option just for one loop.
  const videos = Array.from(document.querySelectorAll("video"))
  for (const v of videos) {
    setAutoPipAttribute(v as HTMLVideoElement, value)
  }
}

function handleMutations(mutations: MutationRecord[]): void {
  if (!autoPipEnabled || !AUTO_PIP_ATTRIBUTE_SUPPORTED) return
  for (const m of mutations) {
    const added = Array.from(m.addedNodes)
    for (const node of added) {
      if (!(node instanceof Element)) continue
      if (node instanceof HTMLVideoElement) {
        setAutoPipAttribute(node, true)
        continue
      }
      // The added node could be a wrapper (e.g. a tweet card) that
      // contains a <video> several levels deep. Sweep its subtree.
      const nested = node.querySelectorAll?.("video")
      if (nested) {
        for (const v of Array.from(nested)) {
          setAutoPipAttribute(v as HTMLVideoElement, true)
        }
      }
    }
  }
}

function startAutoPipObserver(): void {
  if (autoPipObserver || !AUTO_PIP_ATTRIBUTE_SUPPORTED) return
  if (typeof MutationObserver === "undefined") return
  autoPipObserver = new MutationObserver(handleMutations)
  autoPipObserver.observe(document.documentElement, {
    childList: true,
    subtree: true
  })
}

function stopAutoPipObserver(): void {
  if (!autoPipObserver) return
  autoPipObserver.disconnect()
  autoPipObserver = null
}

function requestAutoPictureInPicture(): void {
  if (!autoPipEnabled) return
  if (!document.pictureInPictureEnabled || document.pictureInPictureElement) return

  const video = pickBestVideo()
  if (!video || video.readyState < 2) return

  allowVideoPictureInPicture(video)
  video.requestPictureInPicture().catch(() => {
    // The browser only grants this callback when auto-PiP is eligible.
    // If site policy or media state still blocks PiP, leave the page alone.
  })
}

function syncMediaSessionAutoPipHandler(enabled: boolean): void {
  const mediaSession = navigator.mediaSession
  if (!mediaSession || typeof mediaSession.setActionHandler !== "function") {
    return
  }

  if (!enabled && !mediaSessionAutoPipHandlerInstalled) return

  try {
    ;(mediaSession as any).setActionHandler(
      "enterpictureinpicture",
      enabled ? requestAutoPictureInPicture : null
    )
    mediaSessionAutoPipHandlerInstalled = enabled
  } catch {
    // Older Chromium builds do not recognize enterpictureinpicture.
  }
}

function applyAutoPipState(enabled: boolean): void {
  autoPipEnabled = enabled
  syncMediaSessionAutoPipHandler(enabled)
  if (!AUTO_PIP_ATTRIBUTE_SUPPORTED) return
  if (enabled) {
    applyToAllVideos(true)
    startAutoPipObserver()
  } else {
    stopAutoPipObserver()
    applyToAllVideos(false)
  }
}

// Bootstrap: on script load, read the persisted setting and wire up
// the attribute + observer if it's on. The getter never throws, so we
// don't need a catch — a `false` resolution is the correct no-op.
void getAutoPipEnabled().then((enabled) => {
  // If a PIP_AUTO_CHANGED message already updated state during the
  // storage read, don't clobber it with the stale stored value.
  if (autoPipEnabled !== false) return
  if (enabled) applyAutoPipState(true)
})
