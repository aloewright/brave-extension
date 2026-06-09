import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
  all_frames: false
}

type TtsState = {
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error"
  title?: string
  message?: string
  currentTime?: number
  duration?: number | null
  playbackRate?: number
}

const HOST_ID = "brave-dev-tts-player"
const KEYBOARD_EVENTS = ["keydown", "keypress", "keyup"] as const
let state: TtsState = { status: "idle" }
let visible = false
let mounted = false

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

function formatTime(value: number | null | undefined) {
  if (!Number.isFinite(value || NaN)) return "--:--"
  const seconds = Math.max(0, Math.floor(value || 0))
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`
}

function mount() {
  if (mounted || document.getElementById(HOST_ID)) return
  mounted = true
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
        top: 92px;
        width: min(342px, calc(100vw - 36px));
        color: #f7f1e8;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: none;
      }
      .root[data-visible="true"] { display: block; }
      .root[data-status="loading"] .card::before {
        opacity: 1;
        animation: tts-sweep 1.45s ease-in-out infinite;
      }
      .root[data-status="loading"] .loader {
        display: inline-flex;
      }
      .root[data-status="loading"] .controls {
        opacity: .66;
      }
      .card {
        position: relative;
        border: 1px solid rgba(252, 230, 178, .22);
        border-radius: 14px;
        background:
          radial-gradient(circle at 18% 0%, rgba(255, 199, 95, .24), transparent 36%),
          linear-gradient(145deg, rgba(24, 22, 19, .96), rgba(10, 13, 17, .96));
        box-shadow: 0 22px 60px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.08);
        backdrop-filter: blur(14px);
        overflow: hidden;
      }
      .card::before {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        opacity: 0;
        background: linear-gradient(110deg, transparent 0%, rgba(249, 200, 106, .13) 42%, transparent 72%);
        transform: translateX(-100%);
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 13px 9px;
      }
      .eyebrow {
        color: #f9c86a;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: .14em;
        text-transform: uppercase;
      }
      .title {
        margin-top: 3px;
        color: rgba(247,241,232,.82);
        font-size: 12px;
        line-height: 1.3;
        max-width: 230px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .close {
        width: 28px;
        height: 28px;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 9px;
        color: rgba(247,241,232,.78);
        background: rgba(255,255,255,.04);
        cursor: pointer;
      }
      .controls {
        display: grid;
        grid-template-columns: 42px 42px 1fr 42px;
        align-items: center;
        gap: 8px;
        padding: 0 13px 13px;
      }
      button { font: inherit; }
      .round {
        width: 42px;
        height: 42px;
        border: 1px solid rgba(249,200,106,.22);
        border-radius: 999px;
        color: #181613;
        background: #f9c86a;
        box-shadow: 0 8px 20px rgba(249,200,106,.22);
        cursor: pointer;
        font-weight: 900;
      }
      .ghost {
        color: #f7f1e8;
        background: rgba(255,255,255,.07);
        box-shadow: none;
      }
      .bar { min-width: 0; }
      input[type="range"] { width: 100%; accent-color: #f9c86a; }
      .times {
        display: flex;
        justify-content: space-between;
        color: rgba(247,241,232,.5);
        font-size: 10px;
        margin-top: 2px;
      }
      .message {
        border-top: 1px solid rgba(255,255,255,.08);
        padding: 8px 13px 11px;
        color: rgba(247,241,232,.62);
        font-size: 11px;
        line-height: 1.35;
      }
      .message[data-error="true"] { color: #ffb4a8; }
      .loader {
        display: none;
        align-items: center;
        gap: 3px;
        margin-right: 7px;
        vertical-align: -1px;
      }
      .loader span {
        width: 4px;
        height: 4px;
        border-radius: 999px;
        background: #f9c86a;
        box-shadow: 0 0 10px rgba(249, 200, 106, .35);
        animation: tts-breathe .9s ease-in-out infinite;
      }
      .loader span:nth-child(2) { animation-delay: .12s; }
      .loader span:nth-child(3) { animation-delay: .24s; }
      @keyframes tts-breathe {
        0%, 100% { transform: translateY(0); opacity: .42; }
        50% { transform: translateY(-3px); opacity: 1; }
      }
      @keyframes tts-sweep {
        0% { transform: translateX(-100%); }
        70%, 100% { transform: translateX(100%); }
      }
    </style>
    <div class="root">
      <section class="card" aria-label="Text to speech player">
        <div class="head">
          <div>
            <div class="eyebrow">Speech playback</div>
            <div class="title">Ready</div>
          </div>
          <button class="close" type="button" title="Close" aria-label="Close">x</button>
        </div>
        <div class="controls">
          <button class="round ghost back" type="button" title="Back 10 seconds">-10</button>
          <button class="round play" type="button" title="Play or pause">▶</button>
          <div class="bar">
            <input class="seek" type="range" min="0" max="0" step="0.1" value="0" />
            <div class="times"><span class="current">0:00</span><span class="duration">--:--</span></div>
          </div>
          <button class="round ghost stop" type="button" title="Stop">■</button>
        </div>
        <div class="message"><span class="loader" aria-hidden="true"><span></span><span></span><span></span></span><span class="message-text"></span></div>
      </section>
    </div>
  `
  document.documentElement.appendChild(host)

  const root = shadow.querySelector<HTMLElement>(".root")!
  const title = shadow.querySelector<HTMLElement>(".title")!
  const message = shadow.querySelector<HTMLElement>(".message")!
  const messageText = shadow.querySelector<HTMLElement>(".message-text")!
  const play = shadow.querySelector<HTMLButtonElement>(".play")!
  const back = shadow.querySelector<HTMLButtonElement>(".back")!
  const stop = shadow.querySelector<HTMLButtonElement>(".stop")!
  const close = shadow.querySelector<HTMLButtonElement>(".close")!
  const seek = shadow.querySelector<HTMLInputElement>(".seek")!
  const current = shadow.querySelector<HTMLElement>(".current")!
  const duration = shadow.querySelector<HTMLElement>(".duration")!

  const render = () => {
    visible = state.status !== "idle"
    root.dataset.visible = visible ? "true" : "false"
    root.dataset.status = state.status
    title.textContent = state.title || "Highlighted text"
    messageText.textContent = state.message || (state.status === "loading" ? "Loading speech..." : `${state.playbackRate || 1}x playback`)
    message.dataset.error = state.status === "error" ? "true" : "false"
    play.textContent = state.status === "playing" ? "Ⅱ" : "▶"
    play.disabled = state.status === "loading" || state.status === "error" || state.status === "ended"
    const dur = Number.isFinite(state.duration || NaN) ? Number(state.duration) : 0
    const now = Number.isFinite(state.currentTime || NaN) ? Number(state.currentTime) : 0
    seek.max = String(dur || 0)
    seek.value = String(Math.min(now, dur || now))
    seek.disabled = !dur
    current.textContent = formatTime(now)
    duration.textContent = formatTime(dur || null)
  }

  const control = (action: string, value?: number) => {
    void sendRuntime({ type: "TTS_CONTROL", action, value }).catch(() => undefined)
  }

  play.addEventListener("click", () => control(state.status === "playing" ? "pause" : "play"))
  back.addEventListener("click", () => control("seekBy", -10))
  stop.addEventListener("click", () => control("stop"))
  close.addEventListener("click", () => control("stop"))
  seek.addEventListener("input", () => control("seekTo", Number(seek.value)))

  for (const type of KEYBOARD_EVENTS) {
    window.addEventListener(type, (event) => {
      if (!visible) return
      const active = shadow.activeElement
      if (!active || !root.contains(active)) return
      event.stopPropagation()
      event.stopImmediatePropagation()
    }, true)
  }

  chrome.runtime.onMessage.addListener((incoming) => {
    if (incoming?.type !== "TTS_STATE") return false
    state = { ...state, ...(incoming.state || {}) }
    render()
    return false
  })

  void sendRuntime<{ ok: true; state: TtsState }>({ type: "GET_TTS_STATE" })
    .then((response) => {
      state = response.state
      render()
    })
    .catch(() => undefined)

  render()
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mount, { once: true })
} else {
  mount()
}

export {}
