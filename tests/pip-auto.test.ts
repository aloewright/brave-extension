import { beforeEach, describe, expect, it, vi } from "vitest"

import { PIP_AUTO_CHANGED_MESSAGE } from "../src/lib/pip/auto"

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
