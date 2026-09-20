export type CanvasPageImage = {
  id: string;
  title: string;
  mimeType: string;
  dataBase64: string;
};

export type CanvasPageCaptureDraft = {
  version: 1;
  id: string;
  title: string;
  sourceUrl: string;
  markdown: string;
  images: CanvasPageImage[];
  marginNote?: string;
};

export type CanvasPageExtraction = {
  title: string;
  sourceUrl: string;
  markdown: string;
  images: { id: string; title: string; url: string }[];
};

/** Self-contained because executeScript serializes this function into an isolated world. */
export function extractCanvasPage(): CanvasPageExtraction {
  const pageURL = new URL(location.href);
  const pagePath = /^\/(courses|groups)\/\d+(?:\/(?:pages\/[^/]+|front_page))?\/?$/;
  const content = document.querySelector<HTMLElement>(
    "#wiki_page_show .show-content, #wiki_page_show .user_content, .wiki-page .show-content.user_content, #content .show-content.user_content",
  );
  if (!pagePath.test(pageURL.pathname) || !content) {
    throw new Error("Open a Canvas course page (not the page list or editor), wait for it to load, then try again.");
  }
  const title = (document.querySelector("#wiki_page_show .page-title, .wiki-page .page-title")?.textContent
    || document.querySelector("#content h1")?.textContent || document.title).trim().slice(0, 500);
  const images: CanvasPageExtraction["images"] = [];
  const imageIDs = new Map<string, string>();
  const literal = (text: string) => text.replace(/\u00a0/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/[\\`*_{}\[\]()#+.!|~=-]/g, "\\$&");
  const safeURL = (value: string): string | null => {
    try {
      const url = new URL(value, pageURL);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
      return url.href.replace(/</g, "%3C").replace(/>/g, "%3E");
    } catch { return null; }
  };
  const children = (element: Element, depth = 0): string => Array.from(element.childNodes)
    .map((node) => render(node, depth)).join("");
  const render = (node: Node, depth: number): string => {
    if (node.nodeType === Node.TEXT_NODE) return literal(node.textContent?.replace(/\s+/g, " ") ?? "");
    if (!(node instanceof HTMLElement)) return "";
    const tag = node.tagName.toLowerCase();
    if (["script", "style", "noscript", "form", "button", "input", "textarea", "select", "nav"].includes(tag)
      || node.hidden || node.getAttribute("aria-hidden") === "true") return "";
    if (tag === "img") {
      const img = node as HTMLImageElement;
      // Ignore explicit tracking pixels, but keep unloaded and lazy course images.
      if ((img.getAttribute("width") === "1" && img.getAttribute("height") === "1")
        || (img.naturalWidth === 1 && img.naturalHeight === 1)) return "";
      const raw = img.currentSrc || img.getAttribute("src") || img.getAttribute("data-src") || "";
      const url = raw.startsWith("data:image/") ? raw : safeURL(raw);
      if (!raw || !url) throw new Error("A Canvas image uses an unsupported source. Nothing has been saved.");
      let id = imageIDs.get(url);
      if (!id) {
        if (images.length >= 32) throw new Error("This page has more than 32 images. Save a smaller page instead.");
        id = crypto.randomUUID();
        imageIDs.set(url, id);
        images.push({ id, title: (img.alt || img.title || `Canvas image ${images.length + 1}`).slice(0, 200), url });
      }
      return `\n\n![${literal(img.alt || "Canvas image")}](keepout-capture-image://${id})\n\n`;
    }
    if (tag === "br") return "\n";
    if (tag === "hr") return "\n\n---\n\n";
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${children(node, depth).trim()}\n\n`;
    if (tag === "pre") {
      const raw = node.textContent ?? "";
      const ticks = Math.max(3, ...(raw.match(/`+/g) ?? []).map((run) => run.length + 1));
      const fence = "`".repeat(ticks);
      return `\n\n${fence}\n${raw}\n${fence}\n\n`;
    }
    if (tag === "code") {
      const raw = node.textContent ?? "";
      const fence = "`".repeat(Math.max(1, ...(raw.match(/`+/g) ?? []).map((run) => run.length + 1)));
      return `${fence} ${raw.replace(/\n/g, " ")} ${fence}`;
    }
    if (tag === "ul" || tag === "ol") {
      const start = tag === "ol" ? Number(node.getAttribute("start") || 1) : 1;
      const list = Array.from(node.children).filter((child) => child.tagName === "LI").map((item, index) => {
        const prefix = tag === "ol" ? `${Number.isFinite(start) ? start + index : index + 1}. ` : "- ";
        const body = children(item, depth + 1).trim();
        return `${"  ".repeat(depth)}${prefix}${body.replace(/\n/g, `\n${"  ".repeat(depth + 1)}`)}`;
      }).join("\n");
      return `\n${list}\n`;
    }
    if (tag === "blockquote") return `\n\n${children(node, depth).trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    if (tag === "a") {
      const text = children(node, depth).trim();
      // An image remains a standalone attachment, not an image nested in a link.
      if (node.querySelector("img")) return text;
      const url = safeURL(node.getAttribute("href") || "");
      return url && text ? `[${text}](<${url}>)` : text;
    }
    if (tag === "iframe" || tag === "video" || tag === "audio") {
      const url = safeURL(node.getAttribute("src") || node.querySelector("source")?.getAttribute("src") || "");
      return url ? `\n\n[${literal(node.title || "Embedded media — open in Canvas")}](<${url}>)\n\n` : "";
    }
    if (tag === "table") {
      // Preserve all cells, including complex/image cells, without injecting raw HTML.
      return `\n\n${Array.from(node.querySelectorAll("tr")).map((row) =>
        Array.from(row.children).map((cell) => children(cell, depth).trim()).join(" · "),
      ).join("\n\n")}\n\n`;
    }
    const text = children(node, depth);
    if (["strong", "b"].includes(tag)) return `**${text.trim()}**`;
    if (["em", "i"].includes(tag)) return `*${text.trim()}*`;
    if (["s", "del"].includes(tag)) return `~~${text.trim()}~~`;
    if (["p", "div", "section", "article", "figure", "figcaption"].includes(tag)) return `\n\n${text.trim()}\n\n`;
    return text;
  };
  const markdown = children(content).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!markdown) throw new Error("This Canvas page is empty or has not finished loading.");
  if (new TextEncoder().encode(markdown).length > 256 * 1024) throw new Error("This Canvas page is too large to import (256 KB text limit).");
  // Drop module navigation, access tokens, signed query parameters, and fragments.
  return { title: title || "Canvas page", sourceUrl: pageURL.origin + pageURL.pathname, markdown, images };
}

const TOTAL_LIMIT = 8 * 1024 * 1024;
const mimeExtensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heif",
};

/** Also serialized into the Canvas tab so Brave cookie blocking does not break same-origin images. */
export async function readCanvasImage(url: string, sourceUrl: string): Promise<{ mimeType: string; dataBase64: string; byteCount: number }> {
  const IMAGE_LIMIT = 4 * 1024 * 1024;
  const allowed = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/heic", "image/heif"];
  const target = new URL(url);
  const source = new URL(sourceUrl);
  const embedded = target.protocol === "data:";
  if ((!embedded && !["https:", "http:"].includes(target.protocol)) || target.username || target.password
    || (source.protocol === "https:" && target.protocol === "http:")) throw new Error("An image address is not safe to import.");
  if (embedded && url.length > Math.ceil(IMAGE_LIMIT * 4 / 3) + 128) throw new Error("An image is larger than the 4 MB import limit.");
  const response = await fetch(url, {
    // Session cookies are only needed for the user's Canvas origin. Never copy them or use an API token.
    credentials: target.origin === source.origin ? "include" : "omit",
    cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(20_000),
    referrerPolicy: "no-referrer",
  });
  const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !allowed.includes(mimeType)) throw new Error("An image could not be read. Make sure its Canvas page is signed in and the image is visible.");
  const advertised = Number(response.headers.get("content-length") || 0);
  if (advertised > IMAGE_LIMIT) throw new Error("An image is larger than the 4 MB import limit.");
  if (!response.body) throw new Error("An image returned no data.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > IMAGE_LIMIT) throw new Error("An image is larger than the 4 MB import limit.");
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  if (!length) throw new Error("An image returned no data.");
  const data = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
  let binary = "";
  for (let offset = 0; offset < data.length; offset += 8192) binary += String.fromCharCode(...data.subarray(offset, offset + 8192));
  return { mimeType, dataBase64: btoa(binary), byteCount: data.length };
}

export async function captureCanvasPageFromTab(tabId: number): Promise<CanvasPageCaptureDraft> {
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", func: extractCanvasPage });
  if (!result?.result) throw new Error("Could not read this Canvas page. Wait for it to finish loading and try again.");
  const extracted = result.result;
  const images: CanvasPageImage[] = [];
  let total = 0;
  for (const image of extracted.images) {
    try {
      let loaded: Awaited<ReturnType<typeof readCanvasImage>> | undefined;
      if (new URL(image.url).origin === new URL(extracted.sourceUrl).origin) {
        // Same-origin fetch stays in the authenticated tab. The page's JS cannot see its isolated-world result.
        try {
          const [imageResult] = await chrome.scripting.executeScript({
            target: { tabId }, world: "ISOLATED", func: readCanvasImage, args: [image.url, extracted.sourceUrl],
          });
          loaded = imageResult?.result;
        } catch { /* A CDN redirect may require the extension's existing host permissions instead. */ }
      }
      loaded ??= await readCanvasImage(image.url, extracted.sourceUrl);
      const { mimeType, dataBase64, byteCount } = loaded;
      total += byteCount;
      if (total > TOTAL_LIMIT) throw new Error("This page has more than 8 MB of images.");
      images.push({ id: image.id, title: `${image.title}.${mimeExtensions[mimeType]}`, mimeType, dataBase64 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Image retrieval failed.";
      throw new Error(`Could not import image ${images.length + 1} of ${extracted.images.length}. ${detail} Nothing has been saved.`);
    }
  }
  return { version: 1, id: crypto.randomUUID(), title: extracted.title, sourceUrl: extracted.sourceUrl, markdown: extracted.markdown, images };
}
