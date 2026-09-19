/**
 * Runs in Chrome's isolated world. The host page sees only an empty iframe and
 * an opaque capture ID; all draft content is rendered in the extension-origin
 * document inside that frame.
 */
export function showKeepoutCapturePanel(captureID: string): boolean {
  const existing = document.getElementById("keepout-capture-root");
  if (existing) {
    existing.scrollIntoView({ block: "nearest" });
    return false;
  }
  const host = document.createElement("div");
  host.id = "keepout-capture-root";
  host.style.cssText = "all:initial;position:fixed;z-index:2147483647;right:20px;bottom:20px;width:min(380px,calc(100vw - 40px));height:min(540px,calc(100vh - 40px));";

  const frame = document.createElement("iframe");
  frame.id = "keepout-capture-frame";
  frame.title = "Save browser highlight to Keepout";
  frame.src = `${chrome.runtime.getURL("capture.html")}?capture=${encodeURIComponent(captureID)}`;
  frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent;";
  host.append(frame);
  document.documentElement.appendChild(host);
  return true;
}

/** Removes only the opaque host-page iframe, never the extension page's data. */
export function removeKeepoutCapturePanel(): void {
  document.getElementById("keepout-capture-root")?.remove();
}
