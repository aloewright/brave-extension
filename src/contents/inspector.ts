import type { PlasmoCSConfig } from "plasmo"

import type { ElementSnapshot, InspectorMessage } from "../types"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: false
}

const OVERLAY_ID = "alexometer-inspect-overlay"
const STYLE_ID = "alexometer-inspect-style"

let active = false
let frozen = false
let lastTarget: Element | null = null
let raf = 0

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement("style")
  style.id = STYLE_ID
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
    body[data-alexometer-active] * { cursor: crosshair !important; }
  `
  document.documentElement.appendChild(style)
}

function ensureOverlay(): HTMLDivElement {
  let el = document.getElementById(OVERLAY_ID) as HTMLDivElement | null
  if (el) return el
  el = document.createElement("div")
  el.id = OVERLAY_ID
  document.documentElement.appendChild(el)
  return el
}

function paint(target: Element) {
  const overlay = ensureOverlay()
  const r = target.getBoundingClientRect()
  overlay.style.left = `${r.left}px`
  overlay.style.top = `${r.top}px`
  overlay.style.width = `${r.width}px`
  overlay.style.height = `${r.height}px`
  overlay.style.display = "block"
}

function clearOverlay() {
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) overlay.style.display = "none"
}

function teardown(notify = true) {
  if (!active) return
  active = false
  frozen = false
  lastTarget = null
  document.body.removeAttribute("data-alexometer-active")
  document.removeEventListener("mousemove", onMouseMove, true)
  document.removeEventListener("click", onClick, true)
  document.removeEventListener("keydown", onKey, true)
  const overlay = document.getElementById(OVERLAY_ID)
  if (overlay) overlay.remove()
  const style = document.getElementById(STYLE_ID)
  if (style) style.remove()
  if (notify) {
    try {
      chrome.runtime.sendMessage({ type: "inspector:stopped" } satisfies InspectorMessage)
    } catch {
      /* panel may be closed */
    }
  }
}

function startup() {
  if (active) return
  active = true
  frozen = false
  ensureStyle()
  ensureOverlay()
  document.body.setAttribute("data-alexometer-active", "1")
  document.addEventListener("mousemove", onMouseMove, true)
  document.addEventListener("click", onClick, true)
  document.addEventListener("keydown", onKey, true)
}

function onMouseMove(e: MouseEvent) {
  if (!active || frozen) return
  const overlay = document.getElementById(OVERLAY_ID)
  const candidate = document.elementFromPoint(e.clientX, e.clientY)
  if (!candidate || candidate === overlay) return
  if (candidate === lastTarget) return
  lastTarget = candidate
  if (raf) cancelAnimationFrame(raf)
  raf = requestAnimationFrame(() => {
    if (!lastTarget) return
    paint(lastTarget)
    const snap = buildSnapshot(lastTarget)
    chrome.runtime.sendMessage({ type: "inspector:hover", payload: snap } satisfies InspectorMessage)
  })
}

function onClick(e: MouseEvent) {
  if (!active) return
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  if (!lastTarget) return
  frozen = true
  paint(lastTarget)
  const snap = buildSnapshot(lastTarget)
  chrome.runtime.sendMessage({ type: "inspector:pick", payload: snap } satisfies InspectorMessage)
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && active) {
    if (frozen) {
      frozen = false
      clearOverlay()
    } else {
      teardown()
    }
  }
}

function buildSnapshot(el: Element): ElementSnapshot {
  const cs = window.getComputedStyle(el)
  const rect = el.getBoundingClientRect()
  const computed: Record<string, string> = {}
  for (let i = 0; i < cs.length; i++) {
    const name = cs[i]
    computed[name] = cs.getPropertyValue(name)
  }
  const px = (v: string) => parseFloat(v) || 0
  return {
    tagName: el.tagName,
    selector: buildSelector(el),
    rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    box: {
      margin: {
        top: px(cs.marginTop),
        right: px(cs.marginRight),
        bottom: px(cs.marginBottom),
        left: px(cs.marginLeft)
      },
      border: {
        top: px(cs.borderTopWidth),
        right: px(cs.borderRightWidth),
        bottom: px(cs.borderBottomWidth),
        left: px(cs.borderLeftWidth)
      },
      padding: {
        top: px(cs.paddingTop),
        right: px(cs.paddingRight),
        bottom: px(cs.paddingBottom),
        left: px(cs.paddingLeft)
      },
      width: rect.width,
      height: rect.height
    },
    computed,
    colors: extractColors(cs),
    font: {
      family: cs.fontFamily,
      size: cs.fontSize,
      weight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      letterSpacing: cs.letterSpacing,
      style: cs.fontStyle
    },
    text: el.textContent?.trim().slice(0, 200) || undefined,
    outerHTML: (el as HTMLElement).outerHTML.slice(0, 4000)
  }
}

function extractColors(cs: CSSStyleDeclaration): { kind: "color" | "background" | "border"; value: string }[] {
  const out: { kind: "color" | "background" | "border"; value: string }[] = []
  if (cs.color) out.push({ kind: "color", value: cs.color })
  if (cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)")
    out.push({ kind: "background", value: cs.backgroundColor })
  if (cs.borderTopColor && parseFloat(cs.borderTopWidth) > 0)
    out.push({ kind: "border", value: cs.borderTopColor })
  return out
}

function buildSelector(el: Element): string {
  if (el.id) return `#${cssEscape(el.id)}`
  const tag = el.tagName.toLowerCase()
  const classes = (el.className && typeof el.className === "string"
    ? el.className.trim().split(/\s+/)
    : []
  )
    .filter(Boolean)
    .slice(0, 3)
  return classes.length ? `${tag}.${classes.map(cssEscape).join(".")}` : tag
}

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s)
  return s.replace(/[^a-zA-Z0-9_-]/g, "_")
}

chrome.runtime.onMessage.addListener((message: InspectorMessage, _sender, sendResponse) => {
  if (message.type === "inspector:start") {
    startup()
    sendResponse({ ok: true })
    return
  }
  if (message.type === "inspector:stop") {
    teardown(false)
    sendResponse({ ok: true })
    return
  }
})
