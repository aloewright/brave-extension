import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: false
}

const TOKEN = Math.random().toString(36).slice(2, 10)
const HOST_ID = `surface-${TOKEN}`

type ChatEntry = { role: "user" | "assistant" | "status" | "error"; text: string }

let sessionId: string | undefined
let open = false
const entries: ChatEntry[] = []

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
        width: 44px;
        height: 44px;
        border: 1px solid rgba(255,255,255,.18);
        border-radius: 999px;
        color: #fff;
        background: #171b22;
        box-shadow: 0 10px 30px rgba(0,0,0,.28);
        cursor: pointer;
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
    </style>
    <div class="root">
      <button class="toggle" type="button" title="Page agent" aria-label="Page agent">AI</button>
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
  const close = shadow.querySelector<HTMLButtonElement>(".close")!
  const form = shadow.querySelector<HTMLFormElement>("form")!
  const input = shadow.querySelector<HTMLTextAreaElement>("textarea")!
  const log = shadow.querySelector<HTMLElement>(".log")!

  const render = () => {
    panel.dataset.open = open ? "true" : "false"
    toggle.style.display = open ? "none" : "inline-grid"
    log.replaceChildren(
      ...entries.map((entry) => {
        const node = document.createElement("div")
        node.className = `msg ${entry.role}`
        node.textContent = entry.text
        return node
      })
    )
    log.scrollTop = log.scrollHeight
  }

  toggle.addEventListener("click", () => {
    open = true
    if (entries.length === 0) entries.push({ role: "status", text: "Ready. Page context stays local unless sidebar-api sync is enabled." })
    render()
    input.focus()
  })
  close.addEventListener("click", () => {
    open = false
    render()
  })
  form.addEventListener("submit", async (event) => {
    event.preventDefault()
    const text = input.value.trim()
    if (!text) return
    input.value = ""
    entries.push({ role: "user", text }, { role: "status", text: "Planning with current page observation..." })
    render()
    try {
      const response = await sendRuntime<{
        ok: true
        sessionId: string
        reply: string
        provider: string
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
