import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Window as HappyWindow } from "happy-dom";
import { extractCanvasPage, readCanvasImage, resolveCanvasFileURL, captureCanvasPageFromTab } from "../src/lib/canvas-page-capture";

const source = "https://school.example/courses/42/pages/lesson-one";
beforeEach(() => {
  const testWindow = window as unknown as HappyWindow;
  testWindow.happyDOM.settings.disableIframePageLoading = true;
  testWindow.happyDOM.setURL(source);
  vi.stubGlobal("location", new URL(`${source}?module_item_id=123&access_token=never-save#part`));
  document.body.innerHTML = `<nav>Do not import course navigation</nav><main id="wiki_page_show"><h1 class="page-title">Lesson one</h1><div class="show-content user_content"></div></main>`;
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function content(html: string) { document.querySelector(".show-content")!.innerHTML = html; }

describe("Canvas page capture", () => {
  it("preserves headings, lists, emphasis, links, and image placement without navigation or credentials", () => {
    content(`<h2>Learning &amp; evidence</h2><p>A <strong>useful</strong> example.</p><ul><li>First</li><li>Second</li></ul><p><a href="/courses/42/pages/next">Next page</a></p><img src="/courses/42/files/9/preview" alt="A diagram"><p>After the image</p>`);
    const result = extractCanvasPage();
    expect(result.title).toBe("Lesson one");
    expect(result.sourceUrl).toBe(source);
    expect(result.markdown).toContain("## Learning &amp; evidence");
    expect(result.markdown).toContain("**useful**");
    expect(result.markdown).toContain("- First\n- Second");
    expect(result.markdown).toContain("[Next page](<https://school.example/courses/42/pages/next>)");
    expect(result.markdown).toContain(`![A diagram](keepout-capture-image://${result.images[0].id})`);
    expect(result.markdown.indexOf("keepout-capture-image")).toBeLessThan(result.markdown.indexOf("After the image"));
    expect(result.markdown).not.toContain("course navigation");
    expect(result.images[0].url).toBe("https://school.example/courses/42/files/9/preview");
    expect(result.images[0].canvasFileId).toBe("9");
  });

  it("retains the same-origin Canvas file reference when currentSrc points to storage", () => {
    content(`<img src="/courses/42/files/9/preview" data-api-endpoint="https://school.example/api/v1/courses/42/files/9" data-api-returntype="File">`);
    Object.defineProperty(document.querySelector("img")!, "currentSrc", { value: "https://cdn.example/image.png?signature=transient" });
    const image = extractCanvasPage().images[0];
    expect(image.canvasFileId).toBe("9");
    expect(image.url).toBe("https://cdn.example/image.png?signature=transient");
  });

  it("derives only exact same-origin numeric File routes, never arbitrary API endpoints", () => {
    content(`<img src="/a.png" data-api-endpoint="https://evil.example/api/v1/files/9"><img src="/b.png" data-api-endpoint="/api/v1/courses/42/users"><img src="/c.png" data-api-endpoint="https://user:secret@school.example/api/v1/files/9"><img src="/groups/7/files/10/download"><img src="/files/11/preview">`);
    expect(extractCanvasPage().images.map((image) => image.canvasFileId)).toEqual([undefined, undefined, undefined, "10", "11"]);
  });

  it("never substitutes a different file ID supplied by page metadata", () => {
    content(`<img src="/courses/42/files/9/preview" data-api-endpoint="/api/v1/files/999" data-api-returntype="File"><img src="https://cdn.example/image.png" data-api-endpoint="/api/v1/files/999" data-api-returntype="File">`);
    expect(extractCanvasPage().images.map((image) => image.canvasFileId)).toEqual(["9", undefined]);
  });

  it("resolves signed storage URLs inside the session without an API token", async () => {
    const url = "https://storage.example/image.png?signature=transient";
    const fetcher = vi.fn(async () => new Response(`while(1);${JSON.stringify({ public_url: url })}`, { headers: { "content-type": "application/json; charset=utf-8" } }));
    vi.stubGlobal("fetch", fetcher);
    await expect(resolveCanvasFileURL("9", source)).resolves.toEqual({ ok: true, url });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("https://school.example/api/v1/files/9/public_url", expect.objectContaining({
      credentials: "include", redirect: "error", cache: "no-store", headers: { Accept: "application/json" },
    }));
  });

  it("never resolves arbitrary IDs or a page that navigated away from its Canvas origin", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(resolveCanvasFileURL("../users", source)).resolves.toMatchObject({ ok: false, failure: { kind: "address" } });
    vi.stubGlobal("location", new URL("https://another.example/"));
    await expect(resolveCanvasFileURL("9", source)).resolves.toMatchObject({ ok: false, failure: { kind: "address" } });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects login pages, malformed or oversized metadata and unsafe signed URLs", async () => {
    for (const body of ["<form>sign in</form>", "{}", "not JSON", " ".repeat(64 * 1024 + 1)]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "content-type": "application/json" } })));
      await expect(resolveCanvasFileURL("9", source)).resolves.toMatchObject({ ok: false, failure: { kind: "metadata" } });
    }
    for (const url of ["http://storage.example/image.png", "file:///private/image.png", "https://user:secret@storage.example/image.png", "/relative.png"]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ public_url: url }), { headers: { "content-type": "application/json" } })));
      await expect(resolveCanvasFileURL("9", source)).resolves.toMatchObject({ ok: false, failure: { kind: "address" } });
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response("login", { headers: { "content-type": "text/html" } })));
    await expect(resolveCanvasFileURL("9", source)).resolves.toMatchObject({ ok: false, failure: { kind: "metadata" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("denied", { status: 403 })));
    await expect(resolveCanvasFileURL("9", source)).resolves.toMatchObject({ ok: false, failure: { kind: "http", status: 403 } });
  });

  it("downloads signed bytes with no cookies and never saves a signed URL or file metadata", async () => {
    const signedURL = "https://school.example/download.png?signature=never-save";
    const executeScript = vi.fn(async ({ func, args }: { func?: (...input: any[]) => unknown; args?: any[] }) => {
      if (func && args) return [{ result: await func(...args) }];
      return [{ result: { title: "Lesson", sourceUrl: source, markdown: "Image", images: [{ id: "1", title: "Diagram", url: "https://school.example/courses/42/files/9/preview", canvasFileId: "9" }] } }];
    });
    Object.assign(chrome, { scripting: { executeScript } });
    const fetcher = vi.fn(async (url: string) => url.endsWith("/public_url")
      ? new Response(JSON.stringify({ public_url: signedURL }), { headers: { "content-type": "application/json" } })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetcher);
    const capture = await captureCanvasPageFromTab(9);
    expect(capture.images).toEqual([{ id: "1", title: "Diagram.png", mimeType: "image/png", dataBase64: "AQID" }]);
    expect(fetcher).toHaveBeenLastCalledWith(signedURL, expect.objectContaining({ credentials: "omit" }));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(capture)).not.toMatch(/signature|never-save|canvasFileId|public_url/);
  });

  it("retains the direct image path when the Canvas file API is unavailable", async () => {
    const executeScript = vi.fn(async ({ func, args }: { func?: (...input: any[]) => unknown; args?: any[] }) => {
      if (func && args) return [{ result: await func(...args) }];
      return [{ result: { title: "Lesson", sourceUrl: source, markdown: "Image", images: [{ id: "1", title: "Diagram", url: "https://school.example/files/9/preview", canvasFileId: "9" }] } }];
    });
    Object.assign(chrome, { scripting: { executeScript } });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/public_url")
      ? new Response("denied", { status: 403 })
      : new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })));
    await expect(captureCanvasPageFromTab(9)).resolves.toMatchObject({ images: [{ dataBase64: "AQID" }] });
  });

  it("omits active content and hidden controls; escapes text instead of turning it into executable HTML", () => {
    content(`<p>&lt;script&gt; **literal** [not a link]</p><script>steal()</script><p hidden>Hidden</p><button>Delete course</button><a href="javascript:alert(1)">Safe label</a>`);
    const result = extractCanvasPage();
    expect(result.markdown).toContain("&lt;script&gt;");
    expect(result.markdown).toContain("\\*\\*literal\\*\\*");
    expect(result.markdown).not.toMatch(/steal|Hidden|Delete course|javascript/);
  });

  it("deduplicates repeated images and ignores explicit tracking pixels", () => {
    content(`<img src="/diagram.png"><img src="/diagram.png"><img src="/tracking.gif" width="1" height="1">`);
    const result = extractCanvasPage();
    expect(result.images).toHaveLength(1);
    expect(result.markdown.match(/keepout-capture-image:/g)).toHaveLength(2);
  });

  it("refuses page lists, editors, empty pages, and oversized image collections", () => {
    vi.stubGlobal("location", new URL("https://school.example/courses/42/pages"));
    expect(() => extractCanvasPage()).toThrow(/Open a Canvas/);
    vi.stubGlobal("location", new URL(source));
    expect(() => extractCanvasPage()).toThrow(/empty/);
    content(Array.from({ length: 33 }, (_, i) => `<img src="/${i}.png">`).join(""));
    expect(() => extractCanvasPage()).toThrow(/32 images/);
  });

  it("retains preformatted code and renders embedded media as links, not remote embeds", () => {
    content(`<pre><code>let x = 1;\n  x++;</code></pre><iframe src="https://video.example/embed/123" title="Lecture"></iframe>`);
    const result = extractCanvasPage();
    expect(result.markdown).toContain("```\nlet x = 1;\n  x++;\n```");
    expect(result.markdown).toContain("[Lecture](<https://video.example/embed/123>)");
    expect(result.markdown).not.toContain("<iframe");
  });

  it("reads raster bytes with same-Canvas credentials and excludes cookies for external images", async () => {
    const fetcher = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetcher);
    const image = await readCanvasImage("https://school.example/image.png", source);
    expect(image).toEqual({ mimeType: "image/png", dataBase64: "AQID", byteCount: 3 });
    expect(fetcher).toHaveBeenLastCalledWith("https://school.example/image.png", expect.objectContaining({ credentials: "include", cache: "no-store" }));
    await readCanvasImage("https://cdn.example/image.png", source);
    expect(fetcher).toHaveBeenLastCalledWith("https://cdn.example/image.png", expect.objectContaining({ credentials: "omit" }));
  });

  it("reports HTTP failures separately from safe response-type categories", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    await expect(readCanvasImage("https://school.example/private.png", source)).rejects.toThrow(/HTTP 403/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<form>Sign in</form>", { headers: { "content-type": "text/html" } })));
    await expect(readCanvasImage("https://school.example/private.png", source)).rejects.toThrow(/received text\/html/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })));
    await expect(readCanvasImage("https://school.example/private.svg", source)).rejects.toThrow(/unsupported image\/svg\+xml/);
  });

  it("still captures an authenticated same-origin image when the tab attempt succeeds", async () => {
    const executeScript = vi.fn(async ({ func, args }: { func?: (...input: any[]) => unknown; args?: any[] }) => {
      if (func && args) return [{ result: await func(...args) }];
      return [{ result: { title: "Lesson", sourceUrl: source, markdown: "Image", images: [{ id: "1", title: "Diagram", url: "https://school.example/image.png" }] } }];
    });
    Object.assign(chrome, { scripting: { executeScript } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })));
    await expect(captureCanvasPageFromTab(9)).resolves.toMatchObject({ images: [{ mimeType: "image/png", dataBase64: "AQID" }] });
    expect(executeScript).toHaveBeenCalledTimes(2);
  });

  it("preserves the sanitized tab failure when the extension retry also fails", async () => {
    const executeScript = vi.fn()
      .mockResolvedValueOnce([{ result: { title: "Lesson", sourceUrl: source, markdown: "Image", images: [{ id: "1", title: "Diagram", url: "https://school.example/image.png" }] } }])
      .mockResolvedValueOnce([{ result: { ok: false, failure: { kind: "http", status: 403 } } }]);
    Object.assign(chrome, { scripting: { executeScript } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<form>Sign in</form>", { headers: { "content-type": "text/html" } })));
    await expect(captureCanvasPageFromTab(9)).rejects.toThrow(/Tab attempt: HTTP 403\. Extension attempt: received text\/html\. Nothing has been saved\./);
  });

  it("rejects oversized image bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } })));
    await expect(readCanvasImage("https://school.example/huge.png", source)).rejects.toThrow(/4 MB/);
  });

  it("identifies known unsupported types without exposing arbitrary response headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("image", { headers: { "content-type": "image/avif" } })));
    await expect(readCanvasImage("https://school.example/image", source)).rejects.toThrow("received unsupported image/avif");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("image", { headers: { "content-type": "application/octet-stream" } })));
    await expect(readCanvasImage("https://school.example/image", source)).rejects.toThrow("received application/octet-stream");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("image", { headers: { "content-type": "application/private-signed-value" } })));
    await expect(readCanvasImage("https://school.example/image", source)).rejects.toThrow(/^received a non-image response$/);
  });

  it("does not downgrade HTTPS or read arbitrary local-file schemes", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(readCanvasImage("http://school.example/image.png", source)).rejects.toThrow(/not safe/);
    await expect(readCanvasImage("file:///private/secret", source)).rejects.toThrow(/not safe/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not create a text-only success when an image download fails", async () => {
    Object.assign(chrome, { scripting: { executeScript: vi.fn(async () => [{ result: { title: "Lesson", sourceUrl: source, markdown: "Image", images: [{ id: "1", title: "Diagram", url: "https://cdn.example/fail.png" }] } }]) } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    await expect(captureCanvasPageFromTab(9)).rejects.toThrow(/Nothing has been saved/);
  });
});
