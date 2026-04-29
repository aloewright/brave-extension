/**
 * Auto Picture-in-Picture storage helpers and broadcast.
 *
 * The browser exposes `video.autoPictureInPicture` natively: when set to
 * `true`, Chrome/Brave automatically enter PiP for that video the moment
 * the page loses visibility (tab switch, window blur). Our job is just
 * to store an opt-in flag and broadcast changes to every tab so the
 * content script in each frame can flip the attribute live without a
 * page reload. The broadcast fans out to every frame in every tab via
 * `chrome.webNavigation.getAllFrames`, so iframes (where pip.ts also
 * runs because of `all_frames: true`) pick up the live toggle too —
 * not just the top frame.
 *
 * Why direct `chrome.storage.local` instead of the @plasmohq/storage
 * wrapper used elsewhere: this flag is intentionally kept out of the
 * existing settings shape (`src/types.ts` / `src/storage.ts`) so it can
 * land independently of unrelated WIP in those files. Default is off
 * (key absent === false), so there's no migration to worry about.
 *
 * Both helpers are best-effort and never throw — chrome API failures
 * degrade silently. The getter returns `false`, the setter eats the
 * error. A content script that can't reach the storage API just
 * behaves as if auto-PiP were off.
 */

export const PIP_AUTO_KEY = "leanPipAutoEnabled" as const
export const PIP_AUTO_CHANGED_MESSAGE = "PIP_AUTO_CHANGED" as const

export interface PiPAutoChangedMessage {
  type: typeof PIP_AUTO_CHANGED_MESSAGE
  enabled: boolean
}

/**
 * Read the auto-PiP flag from `chrome.storage.local`. Returns `false`
 * when the key is unset (first run), when the stored value isn't
 * literally `true` (corrupted or wrong type), or when the storage API
 * is unavailable. Never throws.
 */
export async function getAutoPipEnabled(): Promise<boolean> {
  try {
    if (!chrome?.storage?.local) return false
    const result = await chrome.storage.local.get(PIP_AUTO_KEY)
    return result?.[PIP_AUTO_KEY] === true
  } catch {
    return false
  }
}

/**
 * Persist the auto-PiP flag and broadcast the change to every tab.
 *
 * Per-tab `sendMessage` calls each consume their own `lastError` so
 * privileged URLs (chrome://, the Web Store, etc.) don't pollute the
 * runtime log. Any tab that doesn't have the content script loaded is
 * just skipped — when it next loads, the content script reads the
 * persisted value on startup and applies the correct state.
 */
export async function setAutoPipEnabled(enabled: boolean): Promise<void> {
  try {
    if (!chrome?.storage?.local) return
    await chrome.storage.local.set({ [PIP_AUTO_KEY]: enabled })
  } catch {
    // Storage write failed (quota, disabled, etc.). Don't broadcast a
    // change that didn't actually persist — the next page load would
    // disagree with whatever UI dispatched this.
    return
  }

  try {
    if (!chrome?.tabs?.query) return
    const tabs = await chrome.tabs.query({})
    const message: PiPAutoChangedMessage = {
      type: PIP_AUTO_CHANGED_MESSAGE,
      enabled
    }
    await Promise.all(
      tabs.map((tab) => {
        if (typeof tab.id !== "number") return Promise.resolve()
        return broadcastToTabFrames(tab.id, message)
      })
    )
  } catch {
    // tabs.query unavailable or rejected. Already persisted; the next
    // page load will pick up the new value via getAutoPipEnabled.
  }
}

/**
 * Send `message` to every frame in `tabId`. Frames are enumerated via
 * `chrome.webNavigation.getAllFrames` so iframes (where pip.ts also
 * runs because of `all_frames: true`) receive the live toggle too — a
 * top-frame-only sendMessage would silently skip them. Frames that
 * errored at navigation time are skipped.
 *
 * If `chrome.webNavigation.getAllFrames` is unavailable (the
 * webNavigation permission was added in Task 1, but defensive code is
 * cheap), we fall back to a top-frame-only send so the broadcast still
 * reaches the most common case. Never throws; per-frame sendMessage
 * errors are consumed via `chrome.runtime.lastError`.
 */
function broadcastToTabFrames(
  tabId: number,
  message: PiPAutoChangedMessage
): Promise<void> {
  return new Promise((resolve) => {
    const sendToTopFrameOnly = () => {
      try {
        chrome.tabs.sendMessage(tabId, message, () => {
          // Read lastError to defuse the runtime warning for tabs
          // without the content script (chrome://, web store, etc.).
          void chrome.runtime?.lastError
        })
      } catch {
        // sendMessage can synchronously throw on some platforms when
        // the tab is closing or the API is in a bad state. Skip the
        // tab and continue — best-effort broadcast.
      }
      resolve()
    }

    try {
      if (!chrome.webNavigation?.getAllFrames) {
        sendToTopFrameOnly()
        return
      }
      chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
        // Always read lastError to keep the runtime quiet.
        void chrome.runtime?.lastError
        if (!frames || frames.length === 0) {
          // No frames reported — fall back to top-frame-only, which
          // covers the case where the API succeeded but returned an
          // empty list (e.g. tab closed mid-call).
          sendToTopFrameOnly()
          return
        }
        for (const f of frames) {
          if (f.errorOccurred) continue
          try {
            chrome.tabs.sendMessage(tabId, message, { frameId: f.frameId }, () => {
              // Read lastError per-frame: a frame might not have the
              // content script (privileged URLs, sandboxed iframes).
              void chrome.runtime?.lastError
            })
          } catch {
            // Synchronous throw — skip the frame, keep going.
          }
        }
        resolve()
      })
    } catch {
      // getAllFrames threw synchronously — fall back to top-frame-only
      // so we still reach the most common case.
      sendToTopFrameOnly()
    }
  })
}
