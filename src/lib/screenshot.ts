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

export async function cropScreenshot(
  dataUrl: string,
  box: CropBox,
  devicePixelRatio: number,
  maxBytes: number = SCREENSHOT_MAX_BYTES
): Promise<string> {
  const dpr = devicePixelRatio || 1
  const { x, y, w, h } = box
  if (w <= 0 || h <= 0) return dataUrl

  const blob = await (await fetch(dataUrl)).blob()
  const bitmap = await createImageBitmap(blob)

  const sx = Math.max(0, Math.round(x * dpr))
  const sy = Math.max(0, Math.round(y * dpr))
  const sw = Math.max(1, Math.min(Math.round(w * dpr), bitmap.width - sx))
  const sh = Math.max(1, Math.min(Math.round(h * dpr), bitmap.height - sy))

  const canvas = new OffscreenCanvas(sw, sh)
  const ctx = canvas.getContext("2d")
  if (!ctx) return dataUrl
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh)
  bitmap.close?.()

  const png = await canvas.convertToBlob({ type: "image/png" })
  let chosen: Blob = png
  if (png.size > maxBytes) {
    const qualities = [0.92, 0.8, 0.65, 0.5, 0.35]
    for (const q of qualities) {
      const jpg = await canvas.convertToBlob({ type: "image/jpeg", quality: q })
      chosen = jpg
      if (jpg.size <= maxBytes) break
    }
  }
  return await blobToDataUrl(chosen)
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error || new Error("FileReader failed"))
    fr.readAsDataURL(blob)
  })
}
