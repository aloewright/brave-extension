import type { Env } from "./env"
import { ocrImage } from "./ai"

export interface PdfExtractionResult {
  text: string
  pageCount: number | null
  method: "text-layer" | "ocr" | "empty"
}

/**
 * Best-effort PDF text extraction.
 *
 * - Tries `pdfjs-dist` first to read the text layer.
 * - If pdfjs isn't usable in the Workers runtime (the library was designed
 *   for browsers / Node and dynamically requires platform shims), the dynamic
 *   import throws and we fall back to OCR via {@link ocrImage}.
 * - OCR fallback is bounded — we only try the first page in this phase.
 *
 * The Worker keeps running even when extraction fails; the caller writes
 * `text=""` and lets the row land as `status='failed'`. Callers can retry via
 * the reingest endpoint once pdfjs/OCR is tuned.
 */
export async function extractPdfText(env: Env, bytes: Uint8Array): Promise<PdfExtractionResult> {
  const fromTextLayer = await tryTextLayer(bytes)
  if (fromTextLayer && fromTextLayer.text.trim().length >= 50) {
    return { ...fromTextLayer, method: "text-layer" }
  }

  // Fallback: try OCR on the raw bytes. Some Workers AI vision models accept
  // PDF bytes directly. If the model can't read them, the call returns ""
  // and the caller persists `text=""` + page_count=null.
  try {
    const ocrText = await ocrImage(env, bytes)
    if (ocrText.length >= 1) {
      return { text: ocrText, pageCount: fromTextLayer?.pageCount ?? null, method: "ocr" }
    }
  } catch {
    // swallow — fall through to empty result
  }
  return { text: fromTextLayer?.text ?? "", pageCount: fromTextLayer?.pageCount ?? null, method: "empty" }
}

async function tryTextLayer(bytes: Uint8Array): Promise<{ text: string; pageCount: number } | null> {
  try {
    // pdfjs-dist is loaded lazily so a missing/unavailable build doesn't break
    // the Worker bundle at import time.
    const mod = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as {
      getDocument: (src: { data: Uint8Array }) => { promise: Promise<PdfDocumentProxy> }
    }
    const doc = await mod.getDocument({ data: bytes }).promise
    const pages: string[] = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((it) => ("str" in it ? it.str : ""))
        .join(" ")
      pages.push(pageText)
    }
    return { text: pages.join("\n\n").trim(), pageCount: doc.numPages }
  } catch {
    return null
  }
}

// Minimal subset of the pdfjs surface we touch. Avoids depending on @types/pdfjs-dist.
interface PdfDocumentProxy {
  numPages: number
  getPage: (n: number) => Promise<PdfPageProxy>
}
interface PdfPageProxy {
  getTextContent: () => Promise<{ items: Array<{ str?: string }> }>
}
