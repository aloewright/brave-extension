import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  PIP_AUTO_CHANGED_MESSAGE,
  PIP_AUTO_KEY,
  getAutoPipEnabled,
  setAutoPipEnabled
} from "../src/lib/pip/auto"

describe("auto picture-in-picture content script", () => {
  let listeners: Array<
    (
      message: unknown,
      sender: chrome.runtime.MessageSender,
      sendResponse: (response?: unknown) => void
    ) => boolean | void
  >
  let setActionHandler: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    document.body.innerHTML = "<video></video>"
    listeners = []
    setActionHandler = vi.fn()

    ;(globalThis as any).chrome = {
      ...(globalThis as any).chrome,
      runtime: {
        onMessage: {
          addListener: vi.fn((listener) => listeners.push(listener)),
          removeListener: vi.fn()
        }
      }
    }
    Object.defineProperty(navigator, "mediaSession", {
      configurable: true,
      value: { setActionHandler }
    })
  })

  it("uses the media session auto-PiP action when the video attribute is unavailable", async () => {
    expect("autoPictureInPicture" in HTMLVideoElement.prototype).toBe(false)

    await import("../src/contents/pip")

    expect(listeners.length).toBeGreaterThan(0)
    listeners[0](
      { type: PIP_AUTO_CHANGED_MESSAGE, enabled: true },
      {} as chrome.runtime.MessageSender,
      vi.fn()
    )

    expect(setActionHandler).toHaveBeenCalledWith(
      "enterpictureinpicture",
      expect.any(Function)
    )
  })

  it("media session handler requests PiP for the current playable video", async () => {
    const video = document.querySelector("video") as HTMLVideoElement & {
      requestPictureInPicture: ReturnType<typeof vi.fn>
    }
    Object.defineProperty(document, "pictureInPictureEnabled", {
      configurable: true,
      value: true
    })
    Object.defineProperty(video, "readyState", {
      configurable: true,
      value: 2
    })
    video.requestPictureInPicture = vi.fn().mockResolvedValue({})

    await import("../src/contents/pip")
    listeners[0](
      { type: PIP_AUTO_CHANGED_MESSAGE, enabled: true },
      {} as chrome.runtime.MessageSender,
      vi.fn()
    )

    const handler = setActionHandler.mock.calls[0][1] as () => void
    handler()

    expect(video.requestPictureInPicture).toHaveBeenCalledTimes(1)
  })
})

// ALO-471 — Auto-PiP defaults ON for new users (key absent) and for
// existing users who had it on (`true` stored). Only an explicit `false`
// keeps it off.
describe("getAutoPipEnabled — ALO-471 default-on", () => {
  beforeEach(async () => {
    // tests/setup.ts wires chrome.storage.local in-memory; clear it.
    if (chrome?.storage?.local?.clear) {
      await chrome.storage.local.clear()
    }
  })

  it("returns true when the storage key is absent (first run)", async () => {
    expect(await getAutoPipEnabled()).toBe(true)
  })

  it("returns true when stored value is literal true", async () => {
    await chrome.storage.local.set({ [PIP_AUTO_KEY]: true })
    expect(await getAutoPipEnabled()).toBe(true)
  })

  it("returns false only when the user has explicitly disabled it", async () => {
    await chrome.storage.local.set({ [PIP_AUTO_KEY]: false })
    expect(await getAutoPipEnabled()).toBe(false)
  })

  it("setAutoPipEnabled round-trips the explicit-off case", async () => {
    await setAutoPipEnabled(false)
    expect(await getAutoPipEnabled()).toBe(false)
    await setAutoPipEnabled(true)
    expect(await getAutoPipEnabled()).toBe(true)
  })
})
