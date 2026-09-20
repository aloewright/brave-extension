import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Window as HappyWindow } from "happy-dom";
import { extractCanvasPage, readCanvasImage, captureCanvasPageFromTab } from "../src/lib/canvas-page-capture";

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

  it("rejects a login HTML response, active SVG, and oversized image bytes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<form>Sign in</form>", { headers: { "content-type": "text/html" } })));
    await expect(readCanvasImage("https://school.example/private.png", source)).rejects.toThrow(/signed in/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } })));
    await expect(readCanvasImage("https://school.example/private.svg", source)).rejects.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(4 * 1024 * 1024 + 1), { headers: { "content-type": "image/png" } })));
    await expect(readCanvasImage("https://school.example/huge.png", source)).rejects.toThrow(/4 MB/);
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
