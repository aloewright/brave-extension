export {};

type HighlightCapture = {
  version: 1;
  id: string;
  title: string;
  sourceUrl: string;
  selection: string;
  marginNote?: string;
};

type PageCapture = {
  version: 1;
  id: string;
  title: string;
  sourceUrl: string;
  markdown: string;
  images: Array<{ id: string; title: string; mimeType: string; dataBase64: string }>;
  // The capture panel deliberately receives only display metadata. Source
  // URLs (including signed Canvas and Vimeo capability URLs) stay in the
  // background's short-lived draft and are never exposed to this document.
  videos?: Array<{ id: string; title: string; kind: "direct" | "canvas-file" | "vimeo" }>;
  marginNote?: string;
};

type Capture = HighlightCapture | PageCapture;

function isPageCapture(capture: Capture): capture is PageCapture {
  return "markdown" in capture && "images" in capture;
}

function videoDownloadMessage(result: unknown): { text: string; error: boolean; state?: "started" | "complete" } {
  const response = result as { ok?: unknown; error?: unknown; filename?: unknown; state?: unknown } | undefined;
  if (!response?.ok) {
    return {
      text: typeof response?.error === "string" && response.error ? response.error : "Could not start the download.",
      error: true,
    };
  }
  const name = typeof response.filename === "string" && response.filename ? response.filename : "Video";
  if (response.state === "complete") return { text: `${name} downloaded.`, error: false, state: "complete" };
  if (response.state === "started") return { text: `${name} download started.`, error: false, state: "started" };
  return { text: "Could not confirm the download state.", error: true };
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing capture root");

root.innerHTML = `
  <style>
    :root { color-scheme: light dark; font:14px/1.5 system-ui,sans-serif; color:light-dark(#252525,#eee); }
    body { margin:0; background:transparent; } #root { background:light-dark(#faf9f7,#242424); border:1px solid light-dark(#d4d4d4,#555); border-radius:18px; box-shadow:0 12px 48px #0004; padding:20px; max-height:calc(100vh - 2px); overflow:auto; box-sizing:border-box; }
    h1 { font-size:17px; margin:0 0 4px; } p { margin:0 0 14px; font-size:12px; opacity:.75; }
    blockquote,pre { margin:12px 0; padding:10px 12px; border-left:3px solid #888; max-height:120px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; background:light-dark(#eee,#303030); border-radius:4px; font:12px/1.45 ui-monospace,monospace; }
    label { display:block; font-size:12px; font-weight:600; margin-top:14px; }
    input,textarea { font:inherit; display:block; width:100%; padding:10px 12px; margin-top:6px; color:inherit; background:light-dark(#fff,#1b1b1b); border:1px solid light-dark(#bbb,#666); border-radius:9px; box-sizing:border-box; }
    textarea { resize:vertical; min-height:88px; } button { font:inherit; padding:9px 13px; border:1px solid light-dark(#bbb,#666); border-radius:9px; cursor:pointer; background:transparent; color:inherit; } button[type=submit] { background:light-dark(#303030,#ededeb); color:light-dark(#fff,#222); border-color:transparent; } button:disabled { opacity:.5; cursor:wait; } :focus-visible { outline:2px solid light-dark(#333,#fff); outline-offset:3px; } footer { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; } output { display:block; font-size:13px; margin-top:12px; overflow-wrap:anywhere; } output.error { color:light-dark(#a12222,#ffb1b1); } a { color:inherit; display:block; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .videos { margin-top:14px; } .videos h2 { font-size:13px; margin:0; } .videos p { margin:2px 0 7px; } .videos ul { display:grid; gap:6px; padding:0; margin:0; list-style:none; } .videos li { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; } .videos .video-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } .videos output { grid-column:1 / -1; margin:0; }
  </style>
  <section role="dialog" aria-label="Save to Keepout">
    <h1></h1>
    <p></p>
    <a target="_blank" rel="noopener noreferrer"></a>
    <blockquote></blockquote>
    <pre hidden></pre>
    <p class="image-count" hidden></p>
    <section class="videos" hidden>
      <h2>Videos</h2>
      <p>Downloads folder · outside the encrypted vault · started downloads continue after you close this panel</p>
      <ul></ul>
    </section>
    <form>
      <label>Note title<input required maxlength="500" name="title"></label>
      <label>Margin note<textarea name="margin" placeholder="Your thoughts (optional)"></textarea></label>
      <output role="status" aria-live="polite"></output>
      <footer><button type="button">Cancel</button><button type="submit">Save to Keepout</button></footer>
    </form>
  </section>`;

const captureID = new URLSearchParams(location.search).get("capture");
const quote = root.querySelector("blockquote")!;
const markdownPreview = root.querySelector<HTMLElement>("pre")!;
const imageCount = root.querySelector<HTMLElement>(".image-count")!;
const videos = root.querySelector<HTMLElement>(".videos")!;
const videoList = videos.querySelector("ul")!;
const heading = root.querySelector("h1")!;
const detail = root.querySelector("section > p")!;
const link = root.querySelector("a")!;
const title = root.querySelector<HTMLInputElement>('input[name="title"]')!;
const margin = root.querySelector<HTMLTextAreaElement>('textarea[name="margin"]')!;
const status = root.querySelector("output")!;
const form = root.querySelector("form")!;
const cancel = root.querySelector<HTMLButtonElement>('button[type="button"]')!;
const save = root.querySelector<HTMLButtonElement>('button[type="submit"]')!;

let draft: Capture | null = null;
let saving = false;
let saved = false;
let submitted: Capture | undefined;
const videoDownloadTimers = new Set<ReturnType<typeof setTimeout>>();

function clearVideoDownloadTimers() {
  for (const timer of videoDownloadTimers) clearTimeout(timer);
  videoDownloadTimers.clear();
}

function renderVideos(capture: PageCapture) {
  const safeVideos = (capture.videos ?? []).filter((video): video is NonNullable<PageCapture["videos"]>[number] =>
    typeof video?.id === "string" && video.id.length > 0
      && typeof video.title === "string"
      && (video.kind === "direct" || video.kind === "canvas-file" || video.kind === "vimeo"),
  );
  videos.hidden = safeVideos.length === 0;
  videoList.replaceChildren();
  for (const video of safeVideos) {
    const item = document.createElement("li");
    const videoTitle = document.createElement("span");
    videoTitle.className = "video-title";
    videoTitle.textContent = video.title;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Download video";
    const downloadStatus = document.createElement("output");
    downloadStatus.setAttribute("aria-live", "polite");
    const showDownloadError = (message: string) => {
      downloadStatus.className = "error";
      downloadStatus.textContent = message;
      button.disabled = false;
      button.textContent = "Retry download";
    };
    const pollForCompletion = () => {
      const timer = setTimeout(async () => {
        videoDownloadTimers.delete(timer);
        try {
          const result = await chrome.runtime.sendMessage({
            type: "keepout/video-status",
            captureID,
            videoID: video.id,
          });
          const message = videoDownloadMessage(result);
          if (message.error) {
            showDownloadError(message.text);
          } else {
            downloadStatus.className = "";
            downloadStatus.textContent = message.text;
            if (message.state === "started") pollForCompletion();
            else button.textContent = "Downloaded";
          }
        } catch (error) {
          showDownloadError(error instanceof Error ? error.message : "Could not check the download.");
        }
      }, 1_500);
      videoDownloadTimers.add(timer);
    };
    button.addEventListener("click", async () => {
      button.disabled = true;
      button.textContent = "Starting…";
      downloadStatus.className = "";
      downloadStatus.textContent = "Starting download…";
      try {
        const result = await chrome.runtime.sendMessage({
          type: "keepout/video-download",
          captureID,
          videoID: video.id,
        });
        const message = videoDownloadMessage(result);
        if (message.error) {
          showDownloadError(message.text);
        } else {
          downloadStatus.textContent = message.text;
          if (message.state === "started") {
            button.textContent = "Download started";
            pollForCompletion();
          } else {
            button.textContent = "Downloaded";
          }
        }
      } catch (error) {
        showDownloadError(error instanceof Error ? error.message : "Could not start the download.");
      }
    });
    item.append(videoTitle, button, downloadStatus);
    videoList.append(item);
  }
}

function setControlsDisabled(disabled: boolean) {
  save.disabled = disabled;
  cancel.disabled = disabled;
  title.disabled = disabled || Boolean(submitted);
  margin.disabled = disabled || Boolean(submitted);
}

function close() {
  if (saving || !captureID) return;
  clearVideoDownloadTimers();
  void chrome.runtime.sendMessage({ type: "keepout/close", captureID });
}

cancel.addEventListener("click", close);
window.addEventListener("unload", clearVideoDownloadTimers);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!draft || saving || saved || !title.value.trim()) return;
  saving = true;
  setControlsDisabled(true);
  status.className = "";
  status.textContent = "Saving to Keepout…";
  submitted ??= { ...draft, title: title.value.trim(), marginNote: margin.value };
  try {
    const result = await chrome.runtime.sendMessage({
      type: isPageCapture(submitted) ? "keepout/page-capture" : "keepout/capture",
      captureID,
      capture: submitted,
    });
    if (!result?.ok) throw new Error(result?.error || "Keepout did not confirm the save. Retry after unlocking Keepout.");
    saved = true;
    status.textContent = isPageCapture(submitted) ? "Saved to Keepout · Canvas page" : "Saved to Keepout · Browser Highlights";
    save.hidden = true;
    cancel.textContent = "Done";
  } catch (error) {
    status.className = "error";
    status.textContent = `${error instanceof Error ? error.message : "Could not save."} Retry uses the same title and margin note.`;
    save.textContent = "Retry save";
  } finally {
    saving = false;
    setControlsDisabled(false);
  }
});

void (async () => {
  if (!captureID) throw new Error("Missing capture.");
  const response = await chrome.runtime.sendMessage({ type: "keepout/draft", captureID });
  if (!response?.ok || !response.capture) throw new Error(response?.error || "This capture is no longer available.");
  draft = response.capture as Capture;
  if (isPageCapture(draft)) {
    heading.textContent = "Save Canvas page to Keepout";
    detail.textContent = "Rendered Canvas text + images · saved locally in your encrypted vault";
    quote.hidden = true;
    quote.textContent = "";
    markdownPreview.hidden = false;
    markdownPreview.textContent = draft.markdown;
    imageCount.hidden = false;
    imageCount.textContent = `${draft.images.length} image${draft.images.length === 1 ? "" : "s"} will be imported with this page.`;
    renderVideos(draft);
  } else {
    heading.textContent = "Save to Keepout";
    detail.textContent = "Highlight + margin note · saved locally in your encrypted vault";
    quote.hidden = false;
    quote.textContent = draft.selection;
    markdownPreview.hidden = true;
    markdownPreview.textContent = "";
    imageCount.hidden = true;
    imageCount.textContent = "";
    videos.hidden = true;
    videoList.replaceChildren();
  }
  link.textContent = new URL(draft.sourceUrl).hostname;
  link.href = draft.sourceUrl;
  title.value = draft.title;
  margin.focus({ preventScroll: true });
})().catch((error) => {
  status.className = "error";
  status.textContent = error instanceof Error ? error.message : "Could not load this capture.";
  save.disabled = true;
  title.disabled = true;
  margin.disabled = true;
  cancel.disabled = false;
});
