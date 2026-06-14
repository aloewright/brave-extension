import type { ElementSnapshot, InspectorMessage } from "../types";

const DOM_TOKEN = Math.random().toString(36).slice(2, 10);
const OVERLAY_ID = `ui-surface-${DOM_TOKEN}`;
const STYLE_ID = `ui-style-${DOM_TOKEN}`;
const ACTIVE_ATTR = `data-ui-active-${DOM_TOKEN}`;
const KEEPALIVE_PORT = "alexometer-inspector-keepalive";

let active = false;
let frozen = false;
let lastTarget: Element | null = null;
let raf = 0;
let keepalivePort: chrome.runtime.Port | null = null;

// Best-effort send. The runtime throws "Receiving end does not exist" the
// instant the side panel closes; we never want that to bubble into a click
// or mousemove handler and break the underlying page.
function safeSend(msg: InspectorMessage) {
  try {
    chrome.runtime.sendMessage(msg, () => {
      // Touch lastError so Chrome doesn't log it.
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
      border: 2px solid #a7c7e7;
      background: rgba(167, 199, 231, 0.12);
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

function clearOverlay() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.style.display = "none";
}

function teardown(notify = true) {
  if (!active) return;
  active = false;
  frozen = false;
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
  if (notify) safeSend({ type: "inspector:stopped" });
}

function startup() {
  if (active) return;
  active = true;
  frozen = false;
  ensureStyle();
  ensureOverlay();
  document.body.setAttribute(ACTIVE_ATTR, "1");
  document.addEventListener("mousemove", onMouseMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}

function onMouseMove(e: MouseEvent) {
  if (!active || frozen) return;
  const overlay = document.getElementById(OVERLAY_ID);
  const candidate = document.elementFromPoint(e.clientX, e.clientY);
  if (!candidate || candidate === overlay) return;
  if (candidate === lastTarget) return;
  lastTarget = candidate;
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    // Capture as const — teardown() may null lastTarget between rAF schedule
    // and fire.
    const target = lastTarget;
    if (!target) return;
    paint(target);
    safeSend({ type: "inspector:hover", payload: buildSnapshot(target) });
  });
}

function onClick(e: MouseEvent) {
  if (!active) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  const target = lastTarget;
  if (!target) return;
  frozen = true;
  paint(target);
  safeSend({ type: "inspector:pick", payload: buildSnapshot(target) });
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && active) {
    if (frozen) {
      frozen = false;
      clearOverlay();
    } else {
      teardown();
    }
  }
}

function buildSnapshot(el: Element): ElementSnapshot {
  const cs = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const computed: Record<string, string> = {};
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i];
    computed[name] = cs.getPropertyValue(name);
  }
  const px = (v: string) => parseFloat(v) || 0;
  return {
    tagName: el.tagName,
    selector: buildSelector(el),
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    box: {
      margin: {
        top: px(cs.marginTop),
        right: px(cs.marginRight),
        bottom: px(cs.marginBottom),
        left: px(cs.marginLeft),
      },
      border: {
        top: px(cs.borderTopWidth),
        right: px(cs.borderRightWidth),
        bottom: px(cs.borderBottomWidth),
        left: px(cs.borderLeftWidth),
      },
      padding: {
        top: px(cs.paddingTop),
        right: px(cs.paddingRight),
        bottom: px(cs.paddingBottom),
        left: px(cs.paddingLeft),
      },
      width: rect.width,
      height: rect.height,
    },
    computed,
    colors: extractColors(cs),
    font: {
      family: cs.fontFamily,
      size: cs.fontSize,
      weight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      style: cs.fontStyle,
    },
    text: el.textContent?.trim().slice(0, 200) || undefined,
    outerHTML: (el as HTMLElement).outerHTML.slice(0, 4000),
  };
}

function extractColors(
  cs: CSSStyleDeclaration,
): { kind: "color" | "background" | "border"; value: string }[] {
  const out: { kind: "color" | "background" | "border"; value: string }[] = [];
  if (cs.color) out.push({ kind: "color", value: cs.color });
  if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)")
    out.push({ kind: "background", value: cs.backgroundColor });
  if (cs.borderTopColor && parseFloat(cs.borderTopWidth) > 0)
    out.push({ kind: "border", value: cs.borderTopColor });
  return out;
}

function buildSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`;
  const tag = el.tagName.toLowerCase();
  const classes = (
    el.className && typeof el.className === "string"
      ? el.className.trim().split(/\s+/)
      : []
  )
    .filter(Boolean)
    .slice(0, 3);
  return classes.length ? `${tag}.${classes.map(cssEscape).join(".")}` : tag;
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s);
  return s.replace(/[^a-zA-Z0-9_-]/g, "_");
}

chrome.runtime.onMessage.addListener(
  (message: InspectorMessage, _sender, sendResponse) => {
    if (message.type === "inspector:start") {
      startup();
      sendResponse({ ok: true });
      return;
    }
    if (message.type === "inspector:stop") {
      teardown(false);
      sendResponse({ ok: true });
      return;
    }
  },
);

// The side panel opens a long-lived port via chrome.tabs.connect when it
// starts inspecting. When the panel closes (or the InspectTab unmounts),
// the port disconnects automatically — that's our signal to tear the
// inspector down so we don't leave click-capture handlers attached to the
// page after the user navigates away from the panel.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== KEEPALIVE_PORT) return;
  // Replace any prior keepalive (e.g. user re-clicked Start without Stop).
  if (keepalivePort) {
    try {
      keepalivePort.disconnect();
    } catch {
      /* already gone */
    }
  }
  keepalivePort = port;
  port.onDisconnect.addListener(() => {
    if (keepalivePort === port) keepalivePort = null;
    teardown(false);
  });
});
