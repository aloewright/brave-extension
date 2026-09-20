/** Keepout capture is local-only. No cloud fallback, clipboard or disk queue. */
export interface KeepoutCapture {
  version: 1;
  id: string;
  title: string;
  sourceUrl: string;
  selection: string;
  marginNote?: string;
}

export interface KeepoutPageCaptureImage {
  id: string;
  title: string;
  mimeType: string;
  dataBase64: string;
}

/** A rendered Canvas page plus its image bytes, held only in extension memory. */
export interface KeepoutPageCapture {
  version: 1;
  id: string;
  title: string;
  sourceUrl: string;
  markdown: string;
  images: KeepoutPageCaptureImage[];
  marginNote?: string;
}

export interface KeepoutConnection { port: number; token: string }
export interface KeepoutCaptureReceipt { id: string; createdAt: string }
const PORT_KEY = "keepout.connection.port";
const TOKEN_KEY = "keepout.connection.token";
const MAX_BYTES = 256 * 1024;
const MAX_PAGE_CAPTURE_BYTES = 12 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RASTER_IMAGE_MIME_TYPES = new Set([
  "image/avif", "image/bmp", "image/gif", "image/jpeg", "image/png", "image/tiff", "image/webp",
]);

function validatePort(port: number): void {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Enter a local port between 1024 and 65535.");
  }
}

export async function getKeepoutConnection(): Promise<KeepoutConnection> {
  const [local, session] = await Promise.all([
    chrome.storage.local.get(PORT_KEY),
    chrome.storage.session.get(TOKEN_KEY),
  ]);
  return {
    port: typeof local[PORT_KEY] === "number" ? local[PORT_KEY] : 8721,
    token: typeof session[TOKEN_KEY] === "string" ? session[TOKEN_KEY] : "",
  };
}

export async function saveKeepoutConnection(connection: KeepoutConnection): Promise<void> {
  validatePort(connection.port);
  const token = connection.token.trim();
  if (/[\x00-\x20\x7f]/.test(token) || token.length > 4096) {
    throw new Error("Use the bearer token shown in Keepout's Local API settings.");
  }
  // Session storage is memory-only and not exposed to content scripts. Never
  // put the credential into the extension's general/synced settings object.
  await chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  await chrome.storage.local.set({ [PORT_KEY]: connection.port });
  if (token) await chrome.storage.session.set({ [TOKEN_KEY]: token });
  else await chrome.storage.session.remove(TOKEN_KEY);
}

export function validateKeepoutCapture(value: unknown): KeepoutCapture {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid highlight.");
  const capture = value as KeepoutCapture;
  if (capture.version !== 1 || typeof capture.id !== "string" ||
      !UUID_PATTERN.test(capture.id) ||
      typeof capture.title !== "string" || !capture.title.trim() || capture.title.length > 500 ||
      typeof capture.selection !== "string" || !capture.selection.trim() ||
      typeof capture.sourceUrl !== "string" || capture.sourceUrl.length > 8192 ||
      (capture.marginNote !== undefined && typeof capture.marginNote !== "string")) {
    throw new Error("Select some text and enter a note title before saving.");
  }
  let url: URL;
  try { url = new URL(capture.sourceUrl); } catch { throw new Error("This page has no valid source link."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
      /[\x00-\x1f\x7f]/.test(capture.sourceUrl)) {
    throw new Error("Keepout can clip public web page addresses, not browser or file URLs.");
  }
  const clean: KeepoutCapture = {
    version: 1, id: capture.id, title: capture.title.trim(), sourceUrl: capture.sourceUrl,
    selection: capture.selection, marginNote: capture.marginNote ?? "",
  };
  if (new TextEncoder().encode(JSON.stringify(clean)).length > MAX_BYTES) {
    throw new Error("This selection is too large. Save a smaller highlight (under 256 KB).");
  }
  return clean;
}

function validatePageSourceURL(sourceUrl: unknown): string {
  if (typeof sourceUrl !== "string" || sourceUrl.length > 8192 || /[\x00-\x1f\x7f]/.test(sourceUrl)) {
    throw new Error("This Canvas page has no valid source link.");
  }
  let url: URL;
  try { url = new URL(sourceUrl); } catch { throw new Error("This Canvas page has no valid source link."); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Keepout can save Canvas pages from regular web addresses only.");
  }
  return sourceUrl;
}

export function validateKeepoutPageCapture(value: unknown): KeepoutPageCapture {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Canvas page capture.");
  const capture = value as KeepoutPageCapture;
  if (capture.version !== 1 || typeof capture.id !== "string" || !UUID_PATTERN.test(capture.id) ||
      typeof capture.title !== "string" || !capture.title.trim() || capture.title.length > 500 ||
      typeof capture.markdown !== "string" || !capture.markdown.trim() ||
      !Array.isArray(capture.images) ||
      (capture.marginNote !== undefined && typeof capture.marginNote !== "string")) {
    throw new Error("Canvas needs a title and rendered page text before it can be saved.");
  }
  const images = capture.images.map((image): KeepoutPageCaptureImage => {
    if (!image || typeof image !== "object" || Array.isArray(image) ||
        typeof image.id !== "string" || !UUID_PATTERN.test(image.id) ||
        typeof image.title !== "string" || !image.title.trim() || image.title.length > 500 ||
        typeof image.mimeType !== "string" || !RASTER_IMAGE_MIME_TYPES.has(image.mimeType.toLowerCase()) ||
        typeof image.dataBase64 !== "string" || !image.dataBase64 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64)) {
      throw new Error("Canvas included an image that could not be safely imported. Nothing was saved.");
    }
    return { id: image.id, title: image.title.trim(), mimeType: image.mimeType, dataBase64: image.dataBase64 };
  });
  const clean: KeepoutPageCapture = {
    version: 1,
    id: capture.id,
    title: capture.title.trim(),
    sourceUrl: validatePageSourceURL(capture.sourceUrl),
    markdown: capture.markdown,
    images,
    marginNote: capture.marginNote ?? "",
  };
  if (new TextEncoder().encode(JSON.stringify(clean)).length > MAX_PAGE_CAPTURE_BYTES) {
    throw new Error("This Canvas page is too large to import (maximum 12 MiB including images). Nothing was saved.");
  }
  return clean;
}

async function request(path: string, capture?: KeepoutCapture | KeepoutPageCapture): Promise<unknown> {
  const { port, token } = await getKeepoutConnection();
  validatePort(port);
  if (!token) throw new Error("Connect Keepout in the extension's Settings first. Its token lasts for this browser session.");
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: capture ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, ...(capture ? { "Content-Type": "application/json" } : {}) },
      body: capture ? JSON.stringify(capture) : undefined,
      credentials: "omit", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new Error("Cannot reach Keepout. Open and unlock it, enable its Local API on this Mac, then retry.");
  }
  const isCanvasPage = Boolean(capture && "markdown" in capture);
  if (response.status === 401) throw new Error("Keepout rejected the token. Reconnect in the extension's Settings.");
  if (response.status === 423 || response.status === 503) throw new Error(isCanvasPage
    ? "Unlock Keepout and retry. This Canvas page and its images have not been saved."
    : "Unlock Keepout and retry. This highlight has not been saved.");
  if (response.status === 404) throw new Error(isCanvasPage
    ? "Update Keepout to a version that supports Canvas page imports."
    : "Update Keepout to a version that supports browser highlights.");
  if (response.status === 403) throw new Error("Set Keepout's Local API to this Mac only (loopback) to save highlights.");
  if (response.status === 409) throw new Error("This capture identifier is already in use. Close this panel and capture again.");
  if (!response.ok) throw new Error(isCanvasPage
    ? "Keepout could not import this Canvas page. No text-only import was saved; your draft is still here to retry."
    : "Keepout could not save this highlight. Your draft is still here; check Keepout and retry.");
  if (response.status !== (capture ? 201 : 200)) throw new Error("Keepout returned an unexpected save confirmation. Check Keepout before retrying.");
  try { return await response.json(); }
  catch { throw new Error("Keepout returned an invalid confirmation. Check Keepout before retrying."); }
}

export async function testKeepoutConnection(): Promise<void> {
  const result = await request("/v1/captures/status") as { version?: number; pageCaptureVersion?: number; available?: boolean };
  if (result?.version !== 1 || result.available !== true) throw new Error("This endpoint is not a compatible Keepout capture service.");
}

export async function saveKeepoutCapture(value: unknown): Promise<KeepoutCaptureReceipt> {
  const capture = validateKeepoutCapture(value);
  const receipt = await request("/v1/captures", capture) as KeepoutCaptureReceipt;
  if (receipt?.id !== capture.id || typeof receipt.createdAt !== "string" || !Number.isFinite(Date.parse(receipt.createdAt))) {
    throw new Error("No valid save confirmation was received. Check Keepout before retrying.");
  }
  return { id: receipt.id, createdAt: receipt.createdAt };
}

export async function saveKeepoutPageCapture(value: unknown): Promise<KeepoutCaptureReceipt> {
  const capture = validateKeepoutPageCapture(value);
  const receipt = await request("/v1/page-captures", capture) as KeepoutCaptureReceipt;
  if (receipt?.id !== capture.id || typeof receipt.createdAt !== "string" || !Number.isFinite(Date.parse(receipt.createdAt))) {
    throw new Error("No valid Canvas import confirmation was received. Check Keepout before retrying.");
  }
  return { id: receipt.id, createdAt: receipt.createdAt };
}
