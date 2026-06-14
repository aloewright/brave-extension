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

const NO_TAB_ERR =
  "no usable active tab (it may be a restricted browser page like chrome:// or about:); use tabs_list and pass tabId explicitly"

type ToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
  isError?: boolean
}

const EVAL_GATE_KEY = "settings.allowEvalJs"
const QUERY_HTML_LIMIT = 4 * 1024
const QUERY_MAX_MATCHES = 50
const DEFAULT_DOM_BYTES = 64 * 1024
const DEFAULT_WAIT_MS = 5000
const DEFAULT_OBSERVE_NODES = 80
const MAX_OBSERVE_NODES = 200
const DEFAULT_OBSERVE_TEXT = 6000
const MAX_OBSERVE_TEXT = 20000

function err(text: string): ToolResult {
  return { isError: true, content: [{ type: "text", text }] }
}

function ok(text: string): ToolResult {
  return { isError: false, content: [{ type: "text", text }] }
}

function json(value: unknown, isError = false): ToolResult {
  return { isError, content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }
}

function boundedNumber(value: unknown, fallback: number, max: number): number {
  const n = Number(value ?? fallback)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), max)
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

async function collectObservation(tabId: number, args: any = {}) {
  const maxNodes = boundedNumber(args?.maxNodes, DEFAULT_OBSERVE_NODES, MAX_OBSERVE_NODES)
  const maxText = boundedNumber(args?.maxText, DEFAULT_OBSERVE_TEXT, MAX_OBSERVE_TEXT)
  const tab = await chrome.tabs.get(tabId)
  if (isRestrictedUrl(tab.url)) {
    throw new Error("cannot observe restricted browser page")
  }

  const observed = await execIsolated(
    tabId,
    (nodeLimit: number, textLimit: number) => {
      const truncate = (value: string | null | undefined, limit: number) => {
        const clean = String(value ?? "").replace(/\s+/g, " ").trim()
        return clean.length > limit ? `${clean.slice(0, limit)}...[truncated]` : clean
      }

      const isVisible = (el: Element) => {
        const rect = el.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) return false
        const style = window.getComputedStyle(el)
        return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || "1") > 0
      }

      const inferRole = (el: Element) => {
        const explicit = el.getAttribute("role")
        if (explicit) return explicit
        const tag = el.tagName.toLowerCase()
        if (tag === "a" && el.hasAttribute("href")) return "link"
        if (tag === "button") return "button"
        if (tag === "select") return "combobox"
        if (tag === "textarea") return "textbox"
        if (tag === "input") {
          const type = (el.getAttribute("type") || "text").toLowerCase()
          if (type === "checkbox") return "checkbox"
          if (type === "radio") return "radio"
          if (type === "submit" || type === "button") return "button"
          return "textbox"
        }
        if (/^h[1-6]$/.test(tag)) return "heading"
        if (tag === "img") return "img"
        if (tag === "summary") return "button"
        if ((el as HTMLElement).isContentEditable) return "textbox"
        return tag
      }

      const cssEscape = (value: string) => {
        const css = (globalThis as any).CSS
        return css?.escape ? css.escape(value) : value.replace(/["\\#.:,[\]>+~*]/g, "\\$&")
      }

      const selectorFor = (el: Element) => {
        const html = el as HTMLElement
        if (html.id) return `#${cssEscape(html.id)}`
        const parts: string[] = []
        let cur: Element | null = el
        while (cur && cur !== document.documentElement && parts.length < 4) {
          const tag = cur.tagName.toLowerCase()
          const parent = cur.parentElement
          if (!parent) {
            parts.unshift(tag)
            break
          }
          const siblings = Array.from(parent.children).filter((child) => child.tagName === cur!.tagName)
          const index = siblings.indexOf(cur) + 1
          parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${index})` : tag)
          cur = parent
        }
        return parts.join(" > ") || el.tagName.toLowerCase()
      }

      const nameFor = (el: Element) => {
        const labelledBy = el.getAttribute("aria-labelledby")
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent || "")
            .join(" ")
          if (text.trim()) return truncate(text, 160)
        }
        return truncate(
          el.getAttribute("aria-label") ||
            el.getAttribute("alt") ||
            el.getAttribute("title") ||
            (el as HTMLInputElement).placeholder ||
            el.textContent,
          160
        )
      }

      const stateFor = (el: Element) => {
        const anyEl = el as any
        return {
          disabled: anyEl.disabled === true || el.getAttribute("aria-disabled") === "true",
          checked: anyEl.checked === true || el.getAttribute("aria-checked") === "true",
          expanded: el.getAttribute("aria-expanded"),
          selected: anyEl.selected === true || el.getAttribute("aria-selected") === "true"
        }
      }

      const snapshotFor = (el: Element, ref: string) => {
        const rect = el.getBoundingClientRect()
        return {
          ref,
          role: inferRole(el),
          name: nameFor(el),
          text: truncate(el.textContent, 240),
          selector: selectorFor(el),
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          state: stateFor(el)
        }
      }

      const candidates = Array.from(
        document.querySelectorAll(
          [
            "a[href]",
            "button",
            "input",
            "textarea",
            "select",
            "summary",
            "[role]",
            "[aria-label]",
            "[contenteditable='true']",
            "[tabindex]:not([tabindex='-1'])",
            "h1",
            "h2",
            "h3"
          ].join(",")
        )
      ).filter(isVisible)

      const visibleText = truncate(document.body?.innerText || document.body?.textContent || "", textLimit)
      const active = document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement
        ? snapshotFor(document.activeElement, "focused")
        : null

      return {
        url: location.href,
        title: document.title,
        timestamp: Date.now(),
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
        visibleText,
        focusedElement: active,
        nodes: candidates.slice(0, nodeLimit).map((el, index) => snapshotFor(el, `e${index + 1}`)),
        limits: {
          maxNodes: nodeLimit,
          maxText: textLimit,
          nodesFound: candidates.length,
          nodesTruncated: candidates.length > nodeLimit,
          textTruncated: (document.body?.innerText || document.body?.textContent || "").replace(/\s+/g, " ").trim().length > textLimit
        }
      }
    },
    [maxNodes, maxText]
  )

  return {
    ...observed,
    tabId,
    url: tab.url || observed.url,
    title: tab.title || observed.title
  }
}

async function resultWithObservation(tabId: number, result: Record<string, unknown>, args?: any, isError = false): Promise<ToolResult> {
  try {
    return json({ ...result, observation: await collectObservation(tabId, args) }, isError)
  } catch (e) {
    return json({ ...result, observationError: (e as Error).message }, isError)
  }
}

async function waitForTabComplete(tabId: number, timeoutMs: number): Promise<void> {
  const tabs = chrome.tabs
  if (!tabs.onUpdated?.addListener) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(timeoutMs, 250)))
    return
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, timeoutMs)
    const listener = (updatedTabId: number, changeInfo: any) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") done()
    }
    function done() {
      clearTimeout(timer)
      tabs.onUpdated.removeListener(listener)
      resolve()
    }
    tabs.onUpdated.addListener(listener)
  })
}

// ── Handlers ──────────────────────────────────────────────────────────────

async function browser_observe(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  try {
    return json(await collectObservation(tabId, args))
  } catch (e) {
    return err((e as Error).message)
  }
}

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
    return resultWithObservation(tabId, { selector, ...r }, args, !r.ok)
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
    return resultWithObservation(tabId, { selector, ...r }, args, !r.ok)
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
    return resultWithObservation(tabId, { selector, ...r }, args, !r.ok)
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
      if (found) return resultWithObservation(tabId, { selector, found: true }, args)
      const remaining = deadline - Date.now()
      if (remaining <= 0) break
      await new Promise((r) => setTimeout(r, Math.min(100, remaining)))
    }
    return resultWithObservation(tabId, { selector, found: false, message: `timeout waiting for ${selector}` }, args, true)
  } catch (e) {
    return err((e as Error).message)
  }
}

async function navigate(args: any): Promise<ToolResult> {
  const tabId = await resolveTabId(args?.tabId)
  if (tabId == null) return err(NO_TAB_ERR)
  const url = String(args?.url ?? "").trim()
  if (!url) return err("url required")
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return err("url must be absolute")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return err("navigate only supports http(s) URLs")
  }
  try {
    await chrome.tabs.update(tabId, { url })
    await waitForTabComplete(tabId, boundedNumber(args?.timeoutMs, 10_000, 30_000))
    return resultWithObservation(tabId, { url, navigated: true }, args)
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
  browser_observe,
  query_selector,
  click,
  type: type_,
  scroll_to,
  wait_for_selector,
  navigate,
  screenshot,
  screenshot_element,
  get_dom,
  eval_js
}
