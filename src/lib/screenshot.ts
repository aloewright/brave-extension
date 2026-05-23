/**
 * Screenshot helpers shared by the picker (ALO-243) and the
 * `screenshot_element` MCP tool (ALO-245). Crops a visible-tab data URL to
 * a CSS-pixel bounding box, scaling for devicePixelRatio, and re-encodes to
 * keep the result under a size cap (default 200KB).
 */

export const SCREENSHOT_MAX_BYTES = 200 * 1024

export interface CropBox {
  x: number
  y: number
  w: number
  h: number
}

export interface CroppedScreenshot {
  /** Raw base64 (no `data:` prefix). */
  base64: string
  /** Actual mime type of the encoded bytes (`image/png` or `image/jpeg`). */
  mimeType: string
}

/**
 * Crop the given visible-tab data URL and return raw base64 plus the actual
 * mime type. Falls back to JPEG (with progressively lower quality) when the
 * PNG exceeds `maxBytes`; the returned `mimeType` reflects the encoding
 * actually chosen.
 */
export async function cropScreenshot(
  dataUrl: string,
  box: CropBox,
  devicePixelRatio: number,
  maxBytes: number = SCREENSHOT_MAX_BYTES
): Promise<CroppedScreenshot> {
  const dpr = devicePixelRatio || 1
  const { x, y, w, h } = box
  if (w <= 0 || h <= 0) {
    // Degenerate box — return the original frame as-is.
    const passthrough = stripDataUrl(dataUrl)
    return { base64: passthrough.base64, mimeType: passthrough.mimeType }
  }

  const blob = await (await fetch(dataUrl)).blob()
  const bitmap = await createImageBitmap(blob)

  const sx = Math.max(0, Math.round(x * dpr))
  const sy = Math.max(0, Math.round(y * dpr))
  const sw = Math.max(1, Math.min(Math.round(w * dpr), bitmap.width - sx))
  const sh = Math.max(1, Math.min(Math.round(h * dpr), bitmap.height - sy))

  const canvas = new OffscreenCanvas(sw, sh)
  const ctx = canvas.getContext("2d")
  if (!ctx) {
    const passthrough = stripDataUrl(dataUrl)
    return { base64: passthrough.base64, mimeType: passthrough.mimeType }
  }
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  bitmap.close?.()

  const png = await canvas.convertToBlob({ type: "image/png" })
  let chosen: Blob = png
  let chosenType = "image/png"
  if (png.size > maxBytes) {
    const qualities = [0.92, 0.8, 0.65, 0.5, 0.35]
    for (const q of qualities) {
      const jpg = await canvas.convertToBlob({ type: "image/jpeg", quality: q })
      chosen = jpg
      chosenType = "image/jpeg"
      if (jpg.size <= maxBytes) break
    }
  }
  const base64 = await blobToBase64(chosen)
  return { base64, mimeType: chosenType }
}

/**
 * Convenience wrapper for callers that need a `data:` URL (e.g. rendering
 * directly in the sidepanel). Recomposes a data URL from the raw base64.
 */
export async function cropScreenshotDataUrl(
  dataUrl: string,
  box: CropBox,
  devicePixelRatio: number,
  maxBytes: number = SCREENSHOT_MAX_BYTES
): Promise<string> {
  const { base64, mimeType } = await cropScreenshot(dataUrl, box, devicePixelRatio, maxBytes)
  return `data:${mimeType};base64,${base64}`
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error || new Error("FileReader failed"))
    fr.readAsDataURL(blob)
  })
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob)
  return stripDataUrl(dataUrl).base64
}

/**
 * Split a `data:<mime>;base64,<payload>` URL into its mime type and raw
 * base64 payload. If the input isn't a data URL, returns it as-is with an
 * empty mime type.
 */
export function stripDataUrl(dataUrl: string): { base64: string; mimeType: string } {
  const m = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(dataUrl)
  if (!m) return { base64: dataUrl, mimeType: "" }
  return { base64: m[2] || "", mimeType: m[1] || "" }
}
