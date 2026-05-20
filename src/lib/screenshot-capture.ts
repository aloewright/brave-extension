type CaptureVisibleTab = (
  windowId: number | undefined,
  options: chrome.extensionTypes.ImageDetails
) => Promise<string>

type CaptureDesktopFrame = () => Promise<string>

interface CaptureDeps {
  captureVisibleTab?: CaptureVisibleTab
  captureDesktopFrame?: CaptureDesktopFrame
  onFallback?: () => void
}

export interface ScreenshotCaptureResult {
  dataUrl: string
  source: "visible-tab" | "display-picker"
}

export function captureErrorMessage(error: unknown): string {
  if (isActiveTabCaptureError(error)) {
    return "Choose a tab or window to capture"
  }

  const name = (error as DOMException | Error | undefined)?.name
  if (name === "AbortError" || name === "NotAllowedError") {
    return "Screenshot cancelled"
  }

  return error instanceof Error ? error.message : String(error)
}

export function isActiveTabCaptureError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return /activeTab|not been invoked|Chrome pages cannot be captured/i.test(message)
}

export async function captureVisibleOrPromptedScreenshot(
  windowId: number | undefined,
  deps: CaptureDeps = {}
): Promise<ScreenshotCaptureResult> {
  const captureVisibleTab =
    deps.captureVisibleTab ??
    ((id, options) =>
      id === undefined
        ? chrome.tabs.captureVisibleTab(options)
        : chrome.tabs.captureVisibleTab(id, options))

  try {
    return {
      dataUrl: await captureVisibleTab(windowId, { format: "png" }),
      source: "visible-tab"
    }
  } catch (error) {
    if (!isActiveTabCaptureError(error)) throw error
    deps.onFallback?.()
    return {
      dataUrl: await (deps.captureDesktopFrame ?? captureDesktopMediaFrame)(),
      source: "display-picker"
    }
  }
}

function chooseDesktopMediaStream(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!chrome.desktopCapture?.chooseDesktopMedia) {
      reject(new Error("Desktop capture is unavailable"))
      return
    }

    chrome.desktopCapture.chooseDesktopMedia(["tab", "window", "screen"], (streamId) => {
      if (!streamId) {
        reject(new DOMException("Screenshot cancelled", "AbortError"))
        return
      }

      const lastError = chrome.runtime.lastError
      if (lastError) {
        reject(new Error(lastError.message))
        return
      }

      resolve(streamId)
    })
  })
}

async function captureDesktopMediaFrame(): Promise<string> {
  const streamId = await chooseDesktopMediaStream()
  const video = {
    mandatory: {
      chromeMediaSource: "desktop",
      chromeMediaSourceId: streamId
    }
  } as unknown as MediaTrackConstraints
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video
  })

  return captureFrameFromStream(stream)
}

async function captureFrameFromStream(stream: MediaStream): Promise<string> {
  const video = document.createElement("video")
  video.muted = true
  video.playsInline = true
  video.srcObject = stream

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve()
      video.onerror = () => reject(new Error("Could not read selected media"))
      void video.play().catch(() => {
        // Some extension contexts resolve metadata before playback is allowed.
      })
    })

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    const trackSettings = stream.getVideoTracks()[0]?.getSettings?.() ?? {}
    const width = video.videoWidth || trackSettings.width || 1
    const height = video.videoHeight || trackSettings.height || 1
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas is unavailable")
    ctx.drawImage(video, 0, 0, width, height)

    const dataUrl = canvas.toDataURL("image/png")
    if (!dataUrl || dataUrl === "data:,") {
      throw new Error("Could not capture selected media")
    }
    return dataUrl
  } finally {
    for (const track of stream.getTracks()) track.stop()
    video.srcObject = null
  }
}
