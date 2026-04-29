/**
 * DOM/interaction MCP tool handlers (ALO-245, M4).
 *
 * Each handler is invoked by `handleMcpToolCall` in `src/background.ts` with
 * the args from the MCP tool call. They run inside the extension service
 * worker and use chrome.scripting.executeScript to drive the target tab.
 *
 * Result shape: `{ content: [{type, text|data}], isError?: boolean }`.
 */

import { cropScreenshot, stripDataUrl } from "../lib/screenshot"

const RESTRICTED_URL_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "edge://",
  "about:",
  "devtools://",
  "view-source:"
]

function isRestrictedUrl(url: string | undefined | null): boolean {
  if (!url) return false
  return RESTRICTED_URL_PREFIXES.some((p) => url.startsWith(p))
}

const NO_TAB_ERR = "no active tab; pass tabId explicitly"

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}

const EVAL_GATE_KEY = "settings.allowEvalJs"
const QUERY_HTML_LIMIT = 4 * 1024
const QUERY_MAX_MATCHES = 50
const DEFAULT_DOM_BYTES = 64 * 1024
const DEFAULT_WAIT_MS = 5000

function err(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

function ok(text: string): ToolResult {
  return { isError: false, content: [{ type: "text", text }] }
}

async function resolveTabId(tabId: unknown): Promise<number | null> {
  if (typeof tabId === "number" && Number.isFinite(tabId)) return tabId
  // Prefer the last-focused browser window; if no window has focus (e.g.
  // when the call originates from a devtools / popout / unfocused state),
  // fall back to the current window. Filter out chrome:// and friends —
  // content scripts can't run there, so returning one is a footgun.
  let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (!tab) {
    ;[tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  }
  if (!tab || tab.id == null) return null
  if (isRestrictedUrl(tab.url)) return null
  return tab.id
}

/**
 * Run a function in the ISOLATED world of the target tab, returning the
 * single result entry (or throwing if scripting fails).
 */
async function execIsolated<Args extends any[], R>(
  tabId: number,
  func: (...args: Args) => R,
  args: Args
): Promise<R> {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "ISOLATED",
    func: func as any,
    args: args as any
  })
  return result as R
}

// ── Handlers ──────────────────────────────────────────────────────────────

async function query_selector(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const selector = String(args?.selector ?? "")
  if (!selector) return err("selector required")
  const all = !!args?.all

  try {
    const matches = await execIsolated(
      tabId,
      (sel: string, allFlag: boolean, htmlLimit: number, maxMatches: number) => {
        const list = allFlag
          ? Array.from(document.querySelectorAll(sel)).slice(0, maxMatches)
          : [document.querySelector(sel)].filter(Boolean)
        return (list as Element[]).map((el) => {
          const rect = el.getBoundingClientRect()
          const html = el.outerHTML || ""
          return {
            tagName: el.tagName.toLowerCase(),
            id: (el as HTMLElement).id || null,
            classes: el.className && typeof el.className === "string" ? el.className : null,
            text: (el.textContent || "").trim().slice(0, 500),
            outerHTML:
              html.length > htmlLimit ? html.slice(0, htmlLimit) + "…[truncated]" : html,
            boundingBox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
          }
        })
      },
      [selector, all, QUERY_HTML_LIMIT, QUERY_MAX_MATCHES]
    )
    return ok(JSON.stringify({ count: matches.length, matches }, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function click(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const selector = String(args?.selector ?? "")
  if (!selector) return err("selector required")

  try {
    const r = await execIsolated(
      tabId,
      (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return { ok: false, message: "no match" }
        el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" })
        try {
          el.click()
          return { ok: true, message: "clicked" }
        } catch (e) {
          return { ok: false, message: (e as Error).message }
        }
      },
      [selector]
    )
    return ok(JSON.stringify({ selector, ...r }, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function type_(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const selector = String(args?.selector ?? "")
  const text = String(args?.text ?? "")
  if (!selector) return err("selector required")
  const clear = !!args?.clear

  try {
    const r = await execIsolated(
      tabId,
      (sel: string, value: string, clearFirst: boolean) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return { ok: false, message: "no match" }
        ;(el as HTMLElement).focus?.()
        const tag = el.tagName.toLowerCase()
        if (tag === "input" || tag === "textarea") {
          const input = el as HTMLInputElement | HTMLTextAreaElement
          if (clearFirst) input.value = ""
          input.value = (clearFirst ? "" : input.value) + value
          input.dispatchEvent(new Event("input", { bubbles: true }))
          input.dispatchEvent(new Event("change", { bubbles: true }))
          return { ok: true, message: "typed", value: input.value }
        }
        // contenteditable and friends
        if ((el as HTMLElement).isContentEditable) {
          if (clearFirst) (el as HTMLElement).textContent = ""
          // execCommand insertText is the most compatible programmatic input.
          document.execCommand("insertText", false, value)
          el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }))
          return { ok: true, message: "typed", value: el.textContent }
        }
        return { ok: false, message: "element is not a text field" }
      },
      [selector, text, clear]
    )
    return ok(JSON.stringify({ selector, ...r }, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function scroll_to(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const selector = String(args?.selector ?? "")
  if (!selector) return err("selector required")

  try {
    const r = await execIsolated(
      tabId,
      (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return { ok: false, message: "no match" }
        el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" })
        return { ok: true, message: "scrolled" }
      },
      [selector]
    )
    return ok(JSON.stringify({ selector, ...r }, null, 2))
  } catch (e) {
    return err((e as Error).message)
  }
}

async function wait_for_selector(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const selector = String(args?.selector ?? "")
  if (!selector) return err("selector required")
  const timeoutMs = Number(args?.timeoutMs ?? DEFAULT_WAIT_MS)
  const deadline = Date.now() + Math.max(0, timeoutMs)

  try {
    while (Date.now() < deadline) {
      const found = await execIsolated(
        tabId,
        (sel: string) => !!document.querySelector(sel),
        [selector]
      )
      if (found) return ok(JSON.stringify({ selector, found: true }, null, 2))
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await new Promise((r) => setTimeout(r, Math.min(100, remaining)))
    }
    return err(`timeout waiting for ${selector}`)
  } catch (e) {
    return err((e as Error).message)
  }
}

async function screenshot(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const format = args?.format === "jpeg" ? "jpeg" : "png"
  try {
    const tab = await chrome.tabs.get(tabId)
    if (tab.windowId == null) return err("tab has no window")
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format
    })
    // MCP image content blocks expect raw base64 in `data`, not a data URL.
    const { base64, mimeType } = stripDataUrl(dataUrl)
    return {
      isError: false,
      content: [
        { type: "image", data: base64, mimeType: mimeType || `image/${format}` }
      ]
    }
  } catch (e) {
    return err((e as Error).message)
  }
}

async function screenshot_element(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const selector = String(args?.selector ?? "")
  if (!selector) return err("selector required")

  try {
    // chrome.scripting.executeScript does NOT await Promises returned by
    // `func` — an async function would resolve to undefined. Keep this fully
    // synchronous: scroll instantly, then read the rect immediately.
    const info = await execIsolated(
      tabId,
      (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) return null
        el.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "center" })
        const rect = el.getBoundingClientRect()
        return {
          x: rect.x,
          y: rect.y,
          w: rect.width,
          h: rect.height,
          dpr: window.devicePixelRatio || 1
        }
      },
      [selector]
    )
    if (!info) return err(`no match for ${selector}`)
    const tab = await chrome.tabs.get(tabId)
    if (tab.windowId == null) return err("tab has no window")
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
    const { base64, mimeType } = await cropScreenshot(
      dataUrl,
      { x: info.x, y: info.y, w: info.w, h: info.h },
      info.dpr
    )
    return {
      isError: false,
      content: [{ type: "image", data: base64, mimeType }]
    }
  } catch (e) {
    return err((e as Error).message)
  }
}

async function get_dom(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const selector = String(args?.selector ?? "html")
  const maxBytes = Number(args?.maxBytes ?? DEFAULT_DOM_BYTES)

  try {
    const html = await execIsolated(
      tabId,
      (sel: string) => {
        const el =
          sel === "html"
            ? document.documentElement
            : (document.querySelector(sel) as HTMLElement | null)
        if (!el) return null
        return el.outerHTML
      },
      [selector]
    )
    if (html == null) return err(`no match for ${selector}`)
    const truncated =
      html.length > maxBytes ? html.slice(0, maxBytes) + "…[truncated]" : html
    return ok(truncated)
  } catch (e) {
    return err((e as Error).message)
  }
}

async function eval_js(args: any): Promise<ToolResult> {
  const gate = await chrome.storage.local.get(EVAL_GATE_KEY)
  if (!gate?.[EVAL_GATE_KEY]) {
    return err("eval_js disabled in Settings")
  }
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const code = String(args?.code ?? "")
  if (!code) return err("code required")

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (src: string) => {
        try {
          // eslint-disable-next-line no-eval
          const value = (0, eval)(src)
          return { ok: true, value: typeof value === "undefined" ? null : value }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      },
      args: [code]
    })
    if (!result?.ok) return err(`eval error: ${result?.error || "unknown"}`)
    return ok(
      typeof result.value === "string" ? result.value : JSON.stringify(result.value, null, 2)
    )
  } catch (e) {
    return err((e as Error).message)
  }
}

export const DOM_TOOL_HANDLERS: Record<string, (args: any) => Promise<ToolResult>> = {
  query_selector,
  click,
  type: type_,
  scroll_to,
  wait_for_selector,
  screenshot,
  screenshot_element,
  get_dom,
  eval_js
}
