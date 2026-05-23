import type { PlasmoCSConfig } from "plasmo";

import { buildUniqueSelector } from "../lib/selector";
import type { PickerCapture, PickerMessage } from "../types";

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: false,
};

const DOM_TOKEN = Math.random().toString(36).slice(2, 10);
const OVERLAY_ID = `ui-surface-${DOM_TOKEN}`;
const STYLE_ID = `ui-style-${DOM_TOKEN}`;
const ACTIVE_ATTR = `data-ui-active-${DOM_TOKEN}`;

// Caps from the spec (§6 of terminal-mcp-sidebar-design): outerHTML ≤ 8KB,
// textContent ≤ 4KB. The screenshot cap is enforced in the background where
// the bitmap actually lives.
const OUTER_HTML_MAX = 8 * 1024;
const TEXT_MAX = 4 * 1024;

let active = false;
let lastTarget: Element | null = null;
let raf = 0;

function safeSend(msg: PickerMessage) {
  try {
    chrome.runtime.sendMessage(msg, () => {
      void chrome.runtime.lastError;
    });
  } catch {
    /* receiving end gone */
  }
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${OVERLAY_ID} {
      position: fixed;
      pointer-events: none;
      z-index: 2147483646;
      border: 2px solid #f59e0b;
      background: rgba(245, 158, 11, 0.12);
      transition: all 60ms ease-out;
      box-sizing: border-box;
    }
    body[${ACTIVE_ATTR}] * { cursor: crosshair !important; }
  `;
  document.documentElement.appendChild(style);
}

function ensureOverlay(): HTMLDivElement {
  let el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement("div");
  el.id = OVERLAY_ID;
  document.documentElement.appendChild(el);
  return el;
}

function paint(target: Element) {
  const overlay = ensureOverlay();
  const r = target.getBoundingClientRect();
  overlay.style.left = `${r.left}px`;
  overlay.style.top = `${r.top}px`;
  overlay.style.width = `${r.width}px`;
  overlay.style.height = `${r.height}px`;
  overlay.style.display = "block";
}

// Idempotent: safe to call multiple times. onClick disarms `active` and
// removes listeners up-front (to prevent a double-capture race), then calls
// teardown("silent") after capture resolves to clean up the rest.
function teardown(notify: "cancelled" | "captured" | "silent" = "silent") {
  const wasActive = active;
  active = false;
  lastTarget = null;
  if (raf) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  document.body.removeAttribute(ACTIVE_ATTR);
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKey, true);
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.remove();
  const style = document.getElementById(STYLE_ID);
  if (style) style.remove();
  if (notify === "cancelled" && wasActive)
    safeSend({ type: "picker:cancelled" });
}

function startup() {
  if (active) return;
  active = true;
  ensureStyle();
  ensureOverlay();
  document.body.setAttribute(ACTIVE_ATTR, "1");
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}

function onMouseMove(e: MouseEvent) {
  if (!active) return;
  const overlay = document.getElementById(OVERLAY_ID);
  const candidate = document.elementFromPoint(e.clientX, e.clientY);
  if (!candidate || candidate === overlay) return;
  if (candidate === lastTarget) return;
  lastTarget = candidate;
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const target = lastTarget;
    if (!target) return;
    paint(target);
  });
}

function onClick(e: MouseEvent) {
  if (!active) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  // Disarm immediately so a second click during the rAF yield in capture()
  // cannot trigger a second capture. teardown() is idempotent and will
  // clean up the overlay/style/raf/body-attr after capture resolves.
  active = false;
  document.removeEventListener("mousemove", onMouseMove, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("keydown", onKey, true);
  const target = lastTarget || document.elementFromPoint(e.clientX, e.clientY);
  if (!target) {
    teardown("silent");
    return;
  }
  capture(target).then((payload) => {
    safeSend({ type: "picker:captured", payload });
    teardown("silent");
  });
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && active) {
    e.preventDefault();
    e.stopPropagation();
    teardown("cancelled");
  }
}

async function capture(el: Element): Promise<PickerCapture> {
  // Scroll into view if the element is offscreen so the background can crop
  // it out of captureVisibleTab. instant avoids waiting for smooth-scroll.
  const r0 = el.getBoundingClientRect();
  const offscreen =
    r0.bottom < 0 ||
    r0.top > window.innerHeight ||
    r0.right < 0 ||
    r0.left > window.innerWidth;
  if (offscreen) {
    (el as HTMLElement).scrollIntoView({ block: "center", inline: "center" });
    // Yield twice so the page repaints before we read the rect again.
    await new Promise((r) =>
      requestAnimationFrame(() => requestAnimationFrame(r)),
    );
  }

  const rect = el.getBoundingClientRect();
  const outerHTML = (el as HTMLElement).outerHTML.slice(0, OUTER_HTML_MAX);
  const textContent = (el.textContent ?? "").slice(0, TEXT_MAX);

  return {
    selector: buildUniqueSelector(el),
    outerHTML,
    textContent,
    boundingBox: {
      x: rect.left,
      y: rect.top,
      w: rect.width,
      h: rect.height,
    },
    devicePixelRatio: window.devicePixelRatio || 1,
  };
}

chrome.runtime.onMessage.addListener(
  (message: PickerMessage, _sender, sendResponse) => {
    if (message.type === "picker:start") {
      startup();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "picker:cancel") {
      teardown("cancelled");
      sendResponse({ ok: true });
      return;
    }
  },
);
