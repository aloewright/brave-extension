import type { KeepoutCapture } from "./keepout-client";

/** Injected in Chrome's ISOLATED world: no page scripts, raw HTML or imports. */
export function showKeepoutCapturePanel(draft: KeepoutCapture): void {
  const existing = document.getElementById("keepout-capture-root");
  if (existing) {
    // Never replace an unsaved margin note with a second selection.
    existing.scrollIntoView({ block: "nearest" });
    return;
  }
  const previousFocus = document.activeElement as HTMLElement | null;
  const host = document.createElement("div");
  host.id = "keepout-capture-root";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));";
  const shadow = host.attachShadow({ mode: "open" });
  // Only static developer-authored markup is inserted. All page text uses
  // textContent/value below, never HTML interpretation.
  shadow.innerHTML = `
    <style>
      :host { color-scheme: light dark; }
      * { box-sizing:border-box; }
      section { font:14px/1.5 system-ui,sans-serif; color:light-dark(#252525,#eee); background:light-dark(#faf9f7,#242424); border:1px solid light-dark(#d4d4d4,#555); border-radius:18px; box-shadow:0 12px 48px #0004; padding:20px; max-height:calc(100vh - 40px); overflow:auto; }
      h2 { font-size:17px; margin:0 0 4px; } p { margin:0 0 14px; font-size:12px; opacity:.75; }
      blockquote { margin:12px 0; padding:10px 12px; border-left:3px solid #888; max-height:120px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; background:light-dark(#eee,#303030); border-radius:4px; }
      label { display:block; font-size:12px; font-weight:600; margin-top:14px; }
      input,textarea { font:inherit; display:block; width:100%; padding:10px 12px; margin-top:6px; color:inherit; background:light-dark(#fff,#1b1b1b); border:1px solid light-dark(#bbb,#666); border-radius:9px; }
      textarea { resize:vertical; min-height:88px; }
      button { font:inherit; padding:9px 13px; border:1px solid light-dark(#bbb,#666); border-radius:9px; cursor:pointer; background:transparent; color:inherit; }
      button[type=submit] { background:light-dark(#303030,#ededeb); color:light-dark(#fff,#222); border-color:transparent; }
      button:disabled { opacity:.5; cursor:wait; }
      :focus-visible { outline:2px solid light-dark(#333,#fff); outline-offset:3px; }
      footer { display:flex; justify-content:flex-end; gap:8px; margin-top:16px; }
      output { display:block; font-size:13px; margin-top:12px; overflow-wrap:anywhere; }
      output.error { color:light-dark(#a12222,#ffb1b1); }
      a { color:inherit; display:block; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    </style>
    <section role="dialog" aria-label="Save to Keepout">
      <h2>Save to Keepout</h2>
      <p>Highlight + margin note · saved locally in your encrypted vault</p>
      <a target="_blank" rel="noopener noreferrer"></a>
      <blockquote></blockquote>
      <form>
        <label>Note title<input required maxlength="500" name="title"></label>
        <label>Margin note<textarea name="margin" placeholder="Your thoughts (optional)"></textarea></label>
        <output role="status" aria-live="polite"></output>
        <footer><button type="button">Cancel</button><button type="submit">Save to Keepout</button></footer>
      </form>
    </section>`;
  const quote = shadow.querySelector("blockquote")!;
  const link = shadow.querySelector("a")!;
  const title = shadow.querySelector("input")!;
  const margin = shadow.querySelector("textarea")!;
  const status = shadow.querySelector("output")!;
  const form = shadow.querySelector("form")!;
  const cancel = shadow.querySelector<HTMLButtonElement>('button[type="button"]')!;
  const save = shadow.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  quote.textContent = draft.selection;
  link.textContent = new URL(draft.sourceUrl).hostname;
  link.href = draft.sourceUrl;
  title.value = draft.title;
  let saving = false;
  let saved = false;
  let submitted: KeepoutCapture | undefined;
  function close() {
    if (saving) return;
    host.remove();
    previousFocus?.focus({ preventScroll: true });
  }
  cancel.addEventListener("click", close);
  shadow.addEventListener("keydown", (event) => {
    if ((event as KeyboardEvent).key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.isTrusted || saving || saved || !title.value.trim()) return;
    saving = true;
    save.disabled = true;
    cancel.disabled = true;
    title.disabled = true;
    margin.disabled = true;
    status.className = "";
    status.textContent = "Saving to Keepout…";
    // Freeze the first submitted body so an uncertain network retry is exactly
    // the same request, with the same ID (no duplicate note or overwrite).
    submitted ??= { ...draft, title: title.value.trim(), marginNote: margin.value };
    try {
      const result = await chrome.runtime.sendMessage({ type: "keepout/capture", capture: submitted });
      if (!result?.ok) throw new Error(result?.error || "Keepout did not confirm the save. Retry after unlocking Keepout.");
      saved = true;
      status.textContent = "Saved to Keepout · Browser Highlights";
      save.hidden = true;
      cancel.textContent = "Done";
    } catch (error) {
      status.className = "error";
      status.textContent = error instanceof Error ? error.message : "Could not save. Your draft is still here.";
      save.textContent = "Retry save";
    } finally {
      saving = false;
      save.disabled = false;
      cancel.disabled = false;
    }
  });
  document.documentElement.appendChild(host);
  margin.focus({ preventScroll: true });
}
