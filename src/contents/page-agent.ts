import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: false
}

const TOKEN = Math.random().toString(36).slice(2, 10)
const HOST_ID = `surface-${TOKEN}`
const PAGE_AGENT_VISIBLE_KEY = "pageAgent.visible"
const PAGE_AGENT_STATE_KEY = "pageAgent.state"

type StepEntryLite = {
  kind: string
  label?: string
  ok: boolean
  skipped?: boolean
  reason?: string
  durationMs?: number
  selector?: string
  raw: unknown
}

type TextEntry = { role: "user" | "assistant" | "status" | "error"; text: string }
type StepChatEntry = { role: "step"; step: StepEntryLite; expanded: boolean }
type ChatEntry = TextEntry | StepChatEntry

let sessionId: string | undefined
let visible = true
let open = false
let entries: ChatEntry[] = []

function persistState() {
  void chrome.storage?.session?.set?.({
    [PAGE_AGENT_STATE_KEY]: { sessionId, entries, open }
  })
}

const CHAT_KEYBOARD_EVENTS = ["keydown", "keypress", "keyup"] as const

function shouldSubmitChat(event: KeyboardEvent) {
  return event.key === "Enter"
    && !event.shiftKey
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
}

function sendRuntime<T>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError
        if (err) {
          reject(new Error(err.message))
          return
        }
        if (!response?.ok) {
          reject(new Error(response?.error || "request failed"))
          return
        }
        resolve(response as T)
      })
    } catch (err) {
      reject(err)
    }
  })
}

function mount() {
  if (document.getElementById(HOST_ID)) return
  const host = document.createElement("div")
  host.id = HOST_ID
  host.style.all = "initial"
  const shadow = host.attachShadow({ mode: "closed" })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .root {
        position: fixed;
        z-index: 2147483647;
        right: 18px;
        bottom: 18px;
        color: #f5f7fb;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      button, textarea { font: inherit; }
      .toggle {
        display: inline-grid;
        place-items: center;
        width: 58px;
        height: 44px;
        border: 1px solid rgba(90,150,200,.48);
        border-radius: 14px;
        background: rgba(228,241,250,.64);
        box-shadow: 0 10px 30px rgba(28,64,96,.24);
        cursor: pointer;
        backdrop-filter: blur(10px);
      }
      .toggle svg {
        width: 42px;
        height: 30px;
        display: block;
      }
      .panel {
        display: none;
        width: min(360px, calc(100vw - 36px));
        max-height: min(520px, calc(100vh - 36px));
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 8px;
        background: #11151b;
        box-shadow: 0 20px 60px rgba(0,0,0,.38);
      }
      .panel[data-open="true"] { display: flex; flex-direction: column; }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid rgba(255,255,255,.1);
      }
      .title { font-size: 12px; font-weight: 700; letter-spacing: 0; }
      .close {
        width: 26px;
        height: 26px;
        border: 0;
        border-radius: 6px;
        color: #dce4ee;
        background: transparent;
        cursor: pointer;
      }
      .log {
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-height: 180px;
        overflow: auto;
        padding: 12px;
      }
      .msg {
        max-width: 100%;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        line-height: 1.42;
        background: rgba(255,255,255,.07);
      }
      .msg.user { align-self: flex-end; background: #24415f; }
      .msg.status { color: #b9c3cf; background: transparent; padding: 0; }
      .msg.error { color: #ffd4d4; background: rgba(180,40,40,.18); }
      form {
        display: flex;
        gap: 8px;
        padding: 10px;
        border-top: 1px solid rgba(255,255,255,.1);
      }
      textarea {
        flex: 1;
        min-width: 0;
        height: 54px;
        resize: none;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 7px;
        color: #f5f7fb;
        background: #0c1015;
        padding: 8px;
        outline: none;
      }
      .send {
        width: 54px;
        border: 0;
        border-radius: 7px;
        color: #0c1015;
        background: #b7d6ff;
        font-weight: 700;
        cursor: pointer;
      }
      .step {
        font-size: 11px;
        color: #c8d2dc;
        background: rgba(255,255,255,.04);
        border-radius: 6px;
        padding: 6px 8px;
        cursor: pointer;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .step.bad { color: #ffd4d4; }
      .step .detail {
        display: none;
        margin-top: 6px;
        padding: 6px;
        background: #0c1015;
        border-radius: 5px;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .step[data-expanded="true"] .detail { display: block; }
    </style>
    <div class="root">
      <button class="toggle" type="button" title="Page agent" aria-label="Page agent">
        <svg viewBox="0 0 240 160" aria-hidden="true" focusable="false">
          <path d="M60 120C45 120 35 105 40 90C40 70 55 60 70 60C80 35 110 25 135 35C165 30 185 50 180 75C200 75 210 90 205 105C205 120 195 120 180 120Z" fill="rgba(255,255,255,.74)" stroke="#5a96c8" stroke-linejoin="round" stroke-width="6"/>
          <path d="M60 115L180 115" fill="none" stroke="rgba(232,244,250,.78)" stroke-linecap="round" stroke-width="4"/>
          <path d="M20 100Q50 85 70 105T110 95" fill="none" stroke="rgba(140,180,226,.76)" stroke-linecap="round" stroke-width="3.5"/>
          <path d="M90 115Q120 100 140 115T190 105" fill="none" stroke="rgba(140,180,226,.76)" stroke-linecap="round" stroke-width="3.5"/>
          <path d="M160 90Q180 80 200 95T220 85" fill="none" stroke="rgba(140,180,226,.76)" stroke-linecap="round" stroke-width="3.5"/>
        </svg>
      </button>
      <section class="panel" aria-label="Page agent chat">
        <div class="head">
          <div class="title">Page Agent</div>
          <button class="close" type="button" title="Close" aria-label="Close">x</button>
        </div>
        <div class="log"></div>
        <form>
          <textarea name="message" placeholder="Ask about this page"></textarea>
          <button class="send" type="submit">Send</button>
        </form>
      </section>
    </div>
  `
  document.documentElement.appendChild(host)

  const toggle = shadow.querySelector<HTMLButtonElement>(".toggle")!
  const panel = shadow.querySelector<HTMLElement>(".panel")!
  const root = shadow.querySelector<HTMLElement>(".root")!
  const close = shadow.querySelector<HTMLButtonElement>(".close")!
  const form = shadow.querySelector<HTMLFormElement>("form")!
  const input = shadow.querySelector<HTMLTextAreaElement>("textarea")!
  const log = shadow.querySelector<HTMLElement>(".log")!

  const hasPageAgentFocus = () => {
    if (!open) return false
    const active = shadow.activeElement
    return !!active && panel.contains(active)
  }

  const shieldPageAgentKeyboardEvent = (event: KeyboardEvent) => {
    if (!hasPageAgentFocus()) return
    event.stopPropagation()
    event.stopImmediatePropagation()
    if (event.type === "keydown" && shadow.activeElement === input && shouldSubmitChat(event)) {
      event.preventDefault()
      form.requestSubmit()
    }
  }

  const ICON: Record<string, string> = {
    "browser.observe": "👁",
    "browser.click": "🖱",
    "browser.type": "⌨",
    "browser.scroll": "↕",
    "browser.wait": "⏱",
    "browser.navigate": "🧭",
    "memory.search": "🧠",
    "memory.remember": "🧠",
    "session.compact": "🗜"
  }

  const renderStep = (entry: StepChatEntry, idx: number) => {
    const node = document.createElement("div")
    node.className = `step ${entry.step.ok ? "" : "bad"}`.trim()
    node.dataset.expanded = entry.expanded ? "true" : "false"
    const icon = ICON[entry.step.kind] || "·"
    const labelPart = entry.step.label ? ` "${entry.step.label}"` : ""
    const statusPart = entry.step.ok
      ? "✓"
      : entry.step.skipped
        ? `↷ ${entry.step.reason || "skipped"}`
        : `✗ ${entry.step.reason || "failed"}`
    const durationPart = typeof entry.step.durationMs === "number" ? ` ${entry.step.durationMs}ms` : ""
    const summary = document.createElement("div")
    summary.textContent = `▸ ${icon} ${entry.step.kind}${labelPart} · ${statusPart}${durationPart}`
    const detail = document.createElement("pre")
    detail.className = "detail"
    try {
      detail.textContent = JSON.stringify(entry.step.raw, null, 2)
    } catch {
      detail.textContent = String(entry.step.raw)
    }
    node.append(summary, detail)
    node.addEventListener("click", () => {
      const current = entries[idx]
      if (!current || current.role !== "step") return
      entries[idx] = { ...current, expanded: !current.expanded }
      render()
    })
    return node
  }

  const render = () => {
    root.style.display = visible ? "block" : "none"
    panel.dataset.open = open ? "true" : "false"
    toggle.style.display = visible && !open ? "inline-grid" : "none"
    log.replaceChildren(
      ...entries.map((entry, idx) => {
        if (entry.role === "step") return renderStep(entry, idx)
        const node = document.createElement("div")
        node.className = `msg ${entry.role}`
        node.textContent = entry.text
        return node
      })
    )
    log.scrollTop = log.scrollHeight
    persistState()
  }

  const setVisible = (nextVisible: boolean, persist = false) => {
    visible = nextVisible
    if (!visible) open = false
    render()
    if (persist) {
      void chrome.storage?.local?.set?.({ [PAGE_AGENT_VISIBLE_KEY]: visible })
    }
  }

  toggle.addEventListener("click", () => {
    open = true
    if (entries.length === 0) entries.push({ role: "status", text: "Ready. Page context stays local unless cloud planning is enabled." })
    render()
    input.focus()
  })
  close.addEventListener("click", () => {
    open = false
    render()
  })
  for (const type of CHAT_KEYBOARD_EVENTS) {
    window.addEventListener(type, shieldPageAgentKeyboardEvent, true)
  }
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PAGE_AGENT_STEP_EVENT") {
      removeLastStatus()
      entries.push({ role: "step", step: message.step, expanded: false })
      render()
      sendResponse({ ok: true })
      return false
    }
    if (message?.type !== "PAGE_AGENT_TOGGLE") return false
    const nextVisible =
      typeof message.visible === "boolean" ? message.visible : !visible
    setVisible(nextVisible, true)
    if (visible && entries.length === 0) {
      entries.push({ role: "status", text: "Ready. Page context stays local unless cloud planning is enabled." })
      render()
    }
    sendResponse({ ok: true, visible, open })
    return false
  })

  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (!text) return
    input.value = ""
    entries.push({ role: "user", text }, { role: "status", text: "Planning and Executing..." })
    render()
    try {
      const response = await sendRuntime<{
        ok: true
        sessionId: string
        reply: string
        provider: string
        steps: StepEntryLite[]
      }>({ type: "PAGE_AGENT_MESSAGE", sessionId, text })
      sessionId = response.sessionId
      removeLastStatus()
      entries.push({ role: "assistant", text: `${response.reply}\n\nProvider: ${response.provider}` })
    } catch (err) {
      removeLastStatus()
      entries.push({ role: "error", text: err instanceof Error ? err.message : String(err) })
    }
    render()
  })

  render()
  void chrome.storage?.local?.get?.(PAGE_AGENT_VISIBLE_KEY)?.then((result) => {
    const stored = result?.[PAGE_AGENT_VISIBLE_KEY]
    if (typeof stored === "boolean") setVisible(stored)
  })
  
  void chrome.storage?.session?.get?.(PAGE_AGENT_STATE_KEY)?.then((result) => {
    const state = result?.[PAGE_AGENT_STATE_KEY] as { sessionId?: string, entries?: ChatEntry[], open?: boolean } | undefined
    if (state) {
      if (typeof state.sessionId === "string") sessionId = state.sessionId
      if (Array.isArray(state.entries)) entries = state.entries
      if (typeof state.open === "boolean") open = state.open
      render()
    }
  })

  chrome.storage?.onChanged?.addListener?.((changes, area) => {
    if (area !== "local" || !(PAGE_AGENT_VISIBLE_KEY in changes)) return
    const nextVisible = changes[PAGE_AGENT_VISIBLE_KEY].newValue
    if (typeof nextVisible === "boolean") setVisible(nextVisible)
  })
}

function removeLastStatus() {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === "status") {
      entries.splice(i, 1)
      return
    }
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true })
} else {
  mount()
}

export {}
