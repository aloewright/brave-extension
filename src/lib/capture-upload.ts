/**
 * Cloud upload helper for page captures (ALO-467 + ALO-468).
 *
 * The sidebar uses this from `QuickActionsBar` when the user has chosen
 * "cloud" as their capture save location. The Worker route
 * `POST /api/captures` (defined in worker/src/routes/captures.ts) stores
 * the bytes in R2 and queues a Vectorize embedding job. Tokens, URL, and
 * the data URL all come from the resolver in `capture-destination.ts`.
 */
import type { CaptureKind } from "./capture-destination"

export interface UploadCaptureInput {
  apiUrl: string
  apiToken: string
  filename: string
  kind: CaptureKind
  /** Source page URL captured at the moment of the snapshot. */
  pageUrl?: string
  /** Source page title at the moment of the snapshot. */
  pageTitle?: string
  /** Raw bytes — usually a Blob or an ArrayBuffer. */
  body: Blob | ArrayBuffer
  /** Override the mime type used in the upload request. */
  contentType?: string
}

export interface UploadedCapture {
  id: string
  kind: CaptureKind
  filename: string
  url?: string
  sizeBytes: number
  createdAt: string
}

export class CaptureUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string
  ) {
    super(message)
    this.name = "CaptureUploadError"
  }
}

/**
 * POST a capture body to the sidebar-api Worker. Throws CaptureUploadError
 * on non-2xx so callers can render a clear toast and fall back to a local
 * download.
 */
export async function uploadCapture(
  input: UploadCaptureInput,
  fetchImpl: typeof fetch = fetch
): Promise<UploadedCapture> {
  const base = input.apiUrl.replace(/\/+$/, "")
  const endpoint = `${base}/api/captures`
  const contentType =
    input.contentType ??
    (input.kind === "screenshot" ? "image/png" : "application/pdf")

  const res = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "X-Sidebar-Token": input.apiToken,
      "Content-Type": contentType,
      "X-Capture-Kind": input.kind,
      "X-Capture-Filename": encodeRfc5987(input.filename),
      ...(input.pageUrl ? { "X-Capture-Page-Url": input.pageUrl } : {}),
      ...(input.pageTitle
        ? { "X-Capture-Page-Title": encodeRfc5987(input.pageTitle) }
        : {})
    },
    body: input.body
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new CaptureUploadError(
      `Capture upload failed (${res.status})`,
      res.status,
      body
    )
  }

  const payload = (await res.json()) as UploadedCapture
  return payload
}

/**
 * Encode a string for an HTTP header value per RFC 5987 (utf-8 ext-value).
 * Used for filenames and titles that might contain non-ASCII characters.
 */
function encodeRfc5987(input: string): string {
  return encodeURIComponent(input)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%(7C|60|5E)/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    )
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return await res.blob()
}
