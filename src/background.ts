import { ulid } from "./lib/ulid"
import { cropScreenshotDataUrl } from "./lib/screenshot"
import { addHighlight } from "./review"
import { DOM_TOOL_HANDLERS } from "./background/dom-tools"
import { LIBRARY_TOOL_HANDLERS } from "./background/library-tools"
import { startResourcePublishers } from "./background/resource-publishers"
import type { PickerCapture, PickerMessage, Reference } from "./types"

const HOST_NAME = "com.aidev.sidebar"
const HEARTBEAT_ALARM = "native-heartbeat"
let nativePort: chrome.runtime.Port | null = null
let lastDisconnectAt = 0
const pendingCallbacks = new Map<string, (msg: any) => void>()

function connectNativeHost() {
  if (nativePort) return nativePort
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME)

    nativePort.onMessage.addListener((msg: any) => {
      // Drop pongs — they're keepalive noise the sidebar doesn't need.
      if (msg?.type === "pong") return

      // Tool-call bridge from MCP server → background. Currently only a tiny
      // surface (tabs_list) lands here; M4/M5 expand it. Replies are sent
      // back over the same native port using mcp.tool.result.
      if (msg?.type === "mcp.tool.call") {
        void handleMcpToolCall(msg)
        return
      }

      // Forward everything else to all connected sidebar ports.
      for (const [, port] of sidebarPorts) {
        port.postMessage({ type: "native-response", payload: msg })
      }
    })

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || "disconnected"
      const now = Date.now()
      const sinceLast = now - lastDisconnectAt
      lastDisconnectAt = now
      console.warn("Native host disconnected:", err)
      nativePort = null

      // Silent auto-reconnect for transient drops (typical: SW recycled,
      // host process EOF'd, then we wake on the next message). The host
      // re-loads persisted hasSession so the CLI conversation continues.
      // Only surface the failure to the sidebar if reconnects are flapping
      // (multiple disconnects within 5s = real problem, not a recycle).
      if (sidebarPorts.size === 0) return
      const reconnected = connectNativeHost()
      if (reconnected && sinceLast > 5000) return

      for (const [, port] of sidebarPorts) {
        port.postMessage({ type: "native-disconnected", error: err })
      }
    })

    return nativePort
  } catch (err) {
    console.error("Failed to connect native host:", err)
    return null
  }
}

// Heartbeat — keep the SW alive and the native port from going idle.
// chrome.alarms wakes the SW even after it's been GC'd, at which point we
// re-establish the native connection (the host re-loads hasSession from
// disk, so chat context is preserved across SW restarts).
chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return
  // No active sidebar → no reason to keep the host alive. Let the SW idle
  // out and the host EOF naturally.
  if (sidebarPorts.size === 0) return
  const port = nativePort ?? connectNativeHost()
  if (!port) return
  try {
    port.postMessage({ type: "ping" })
  } catch {
    // postMessage on a torn-down port throws — let the next disconnect
    // handler reconnect it.
  }
})

function sendToNative(msg: any) {
  const port = connectNativeHost()
  if (port) {
    port.postMessage(msg)
  } else {
    // Notify sidebars about connection failure
    for (const [, p] of sidebarPorts) {
      p.postMessage({
        type: "native-response",
        payload: {
          type: "error",
          data: "Native host not connected. Run: npm run install-host"
        }
      })
    }
  }
}

// ─── Tab recording state ──────────────────────────────────────────────
// We keep the MediaRecorder in an offscreen document because service
// workers can't run MediaRecorder. Background orchestrates lifecycle and
// exposes the red-dot badge indicator while recording is active.

const OFFSCREEN_URL = "tabs/offscreen.html"
const RECORDING_SETTINGS_KEY = "ai-dev-settings"

interface RecordingState {
  active: boolean
  tabId: number | null
  startedAt: number | null
  lastUpload: { key?: string; url?: string; size: number; at: number } | null
  lastError: string | null
}

const recording: RecordingState = {
  active: false,
  tabId: null,
  startedAt: null,
  lastUpload: null,
  lastError: null
}

// Queue a pending start message until the offscreen document signals ready
let pendingStart: {
  streamId: string
  uploadUrl: string
  serviceToken?: string
} | null = null

async function hasOffscreen(): Promise<boolean> {
  // @ts-ignore — available on MV3 Chrome
  const existing = await chrome.runtime.getContexts?.({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  })
  return Array.isArray(existing) && existing.length > 0
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return
  // @ts-ignore — chrome.offscreen is available with "offscreen" permission
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["USER_MEDIA"],
    justification: "Record the active tab to save as a video in media storage"
  })
}

async function closeOffscreen() {
  if (!(await hasOffscreen())) return
  try {
    // @ts-ignore
    await chrome.offscreen.closeDocument()
  } catch {
    // ignore
  }
}

function setRecordingBadge(on: boolean) {
  if (on) {
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" })
    chrome.action.setTitle({ title: "Recording tab — click to stop" })
    // Show the popup during recording so the toolbar click reveals a Stop
    // button. In idle, no popup → click opens the sidebar directly.
    chrome.action.setPopup({ popup: "popup.html" })
  } else {
    chrome.action.setBadgeText({ text: "" })
    chrome.action.setTitle({ title: "AI Dev Sidebar" })
    chrome.action.setPopup({ popup: "" })
  }
}

async function getRecordingUploadConfig(): Promise<{ uploadUrl: string; serviceToken?: string }> {
  const result = await chrome.storage.local.get(RECORDING_SETTINGS_KEY)
  const settings = result[RECORDING_SETTINGS_KEY] as
    | { cloudosNotesUrl?: string; cloudosServiceToken?: string }
    | undefined
  // Derive the media upload URL from the existing notes URL the user already
  // configured: https://notes.pdx.software/api/notes → .../api/media/upload
  const notesUrl = settings?.cloudosNotesUrl || "https://notes.pdx.software/api/notes"
  const uploadUrl = notesUrl.replace(/\/api\/notes\/?$/, "/api/media/upload")
  return { uploadUrl, serviceToken: settings?.cloudosServiceToken || undefined }
}

function broadcastRecordingState() {
  const payload = { type: "recording-state", state: { ...recording } }
  for (const [, port] of sidebarPorts) {
    try {
      port.postMessage(payload)
    } catch {
      // ignore
    }
  }
}

async function startTabRecording(targetTabId?: number): Promise<{ ok: boolean; error?: string }> {
  if (recording.active) return { ok: false, error: "Already recording" }
  try {
    let tabId = targetTabId
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return { ok: false, error: "No active tab" }
      tabId = tab.id
    }

    // Mint a media stream id for the target tab. Consumer is the offscreen
    // document, which doesn't have a tab id — leaving consumerTabId unset
    // lets any document in this extension consume it.
    const streamId = await new Promise<string>((resolve, reject) => {
      chrome.tabCapture.getMediaStreamId({ targetTabId: tabId! }, (id) => {
        if (chrome.runtime.lastError || !id) {
          reject(new Error(chrome.runtime.lastError?.message || "No stream id"))
        } else {
          resolve(id)
        }
      })
    })

    const { uploadUrl, serviceToken } = await getRecordingUploadConfig()
    pendingStart = { streamId, uploadUrl, serviceToken }
    await ensureOffscreen()
    // The offscreen page will send OFFSCREEN_READY when mounted; at that
    // point we flush the pending start. It also might mount instantly if
    // the document was already open — send the start message directly.
    chrome.runtime.sendMessage({
      type: "OFFSCREEN_START",
      streamId,
      uploadUrl,
      serviceToken
    }).catch(() => {
      // no listener yet — handler below on OFFSCREEN_READY will retry
    })

    recording.active = true
    recording.tabId = tabId
    recording.startedAt = Date.now()
    recording.lastError = null
    setRecordingBadge(true)
    broadcastRecordingState()
    return { ok: true }
  } catch (err) {
    recording.lastError = (err as Error).message
    setRecordingBadge(false)
    return { ok: false, error: recording.lastError }
  }
}

async function stopTabRecording(): Promise<{ ok: boolean }> {
  if (!recording.active) return { ok: false }
  chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP" }).catch(() => {})
  // Actual cleanup happens on OFFSCREEN_UPLOADED / OFFSCREEN_ERROR
  return { ok: true }
}

// Track sidebar connections
const sidebarPorts = new Map<string, chrome.runtime.Port>()

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "ai-dev-sidebar") {
    const id = crypto.randomUUID()
    sidebarPorts.set(id, port)

    port.onMessage.addListener((msg: any) => {
      if (msg.type === "native-send") {
        sendToNative(msg.payload)
      }
    })

    port.onDisconnect.addListener(() => {
      sidebarPorts.delete(id)
    })
  }
})

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "NATIVE_SEND") {
    sendToNative(message.payload)
    sendResponse({ ok: true })
  }

  if (message.type === "NATIVE_STATUS") {
    sendResponse({ connected: !!nativePort })
  }

  if (message.type === "SCRAPE_TAB") {
    scrapeTab(message.tabId).then((result) => sendResponse(result))
    return true
  }

  if (message.type === "GET_CONSOLE_ERRORS") {
    sendResponse({ errors: consoleErrors.get(message.tabId) || [] })
  }

  if (message.type === "PAGE_ERRORS") {
    // Content script reports console errors
    const existing = consoleErrors.get(sender.tab?.id || 0) || []
    consoleErrors.set(sender.tab?.id || 0, [...existing, ...message.errors].slice(-100))
    sendResponse({ ok: true })
  }

  // ─── Recording control ──────────────────────────────────────────────

  if (message.type === "START_RECORDING") {
    startTabRecording(message.tabId).then((result) => sendResponse(result))
    return true
  }

  if (message.type === "STOP_RECORDING") {
    stopTabRecording().then((result) => sendResponse(result))
    return true
  }

  if (message.type === "GET_RECORDING_STATE") {
    sendResponse({ state: { ...recording } })
  }

  // ─── Offscreen document lifecycle events ────────────────────────────

  if (message.type === "OFFSCREEN_READY") {
    // Flush a queued start if background raced ahead of the document mount
    if (pendingStart) {
      chrome.runtime.sendMessage({ type: "OFFSCREEN_START", ...pendingStart }).catch(() => {})
      pendingStart = null
    }
  }

  if (message.type === "OFFSCREEN_STARTED") {
    broadcastRecordingState()
  }

  if (message.type === "OFFSCREEN_UPLOADED") {
    recording.active = false
    recording.tabId = null
    recording.startedAt = null
    recording.lastUpload = {
      key: message.key,
      url: message.url,
      size: message.size,
      at: Date.now()
    }
    recording.lastError = null
    setRecordingBadge(false)
    broadcastRecordingState()
    closeOffscreen()
  }

  // ─── Picker routing ─────────────────────────────────────────────────

  if (message.type === "picker:start") {
    const tabId = message.tabId
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId required" })
      return
    }
    startPicker(tabId)
      .then((ref) => sendResponse({ ok: true, reference: ref }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }))
    return true
  }

  if (message.type === "picker:cancel") {
    const tabId = message.tabId
    if (typeof tabId === "number") {
      cancelPicker(tabId).then(() => sendResponse({ ok: true }))
      return true
    }
    sendResponse({ ok: false, error: "tabId required" })
  }

  if (message.type === "picker:captured") {
    const tabId = sender.tab?.id
    if (typeof tabId === "number") {
      void finalizeCapture(tabId, (message as PickerMessage & { payload: PickerCapture }).payload)
    }
    sendResponse({ ok: true })
  }

  if (message.type === "picker:cancelled") {
    const tabId = sender.tab?.id
    if (typeof tabId === "number") rejectPending(tabId, "user-cancelled")
    sendResponse({ ok: true })
  }

  if (message.type === "OFFSCREEN_ERROR") {
    recording.active = false
    recording.tabId = null
    recording.startedAt = null
    recording.lastError = message.error || "Recording failed"
    setRecordingBadge(false)
    broadcastRecordingState()
    closeOffscreen()
  }
})

// Console error tracking per tab
const consoleErrors = new Map<number, any[]>()

// Scrape page content
async function scrapeTab(tabId: number) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta: Record<string, string> = {}
        document.querySelectorAll("meta").forEach((m) => {
          const name = m.getAttribute("name") || m.getAttribute("property") || ""
          const content = m.getAttribute("content") || ""
          if (name && content) meta[name] = content
        })

        const links = Array.from(document.querySelectorAll("a[href]")).map((a) => ({
          href: (a as HTMLAnchorElement).href,
          text: a.textContent?.trim().slice(0, 100) || ""
        })).filter((l) => l.href.startsWith("http")).slice(0, 200)

        const images = Array.from(document.querySelectorAll("img[src]")).map((img) => ({
          src: (img as HTMLImageElement).src,
          alt: (img as HTMLImageElement).alt || ""
        })).slice(0, 100)

        // Get clean text content
        const clone = document.body.cloneNode(true) as HTMLElement
        clone.querySelectorAll("script, style, nav, footer, header").forEach((el) => el.remove())
        const text = clone.textContent?.replace(/\s+/g, " ").trim().slice(0, 30000) || ""

        return {
          url: location.href,
          title: document.title,
          text,
          html: document.documentElement.outerHTML.slice(0, 100000),
          links,
          images,
          meta,
          timestamp: Date.now()
        }
      }
    })

    return results[0]?.result || null
  } catch (err) {
    return { error: (err as Error).message }
  }
}

// ─── Element picker (Reference capture, ALO-243) ────────────────────────
// Sidepanel calls `picker:start` with a tabId. Background tells the
// content script to start the picker, awaits a `picker:captured` message,
// crops the visible-tab screenshot to the element's bounding box, packs a
// Reference and resolves the original sender. Auto-cancels on tab nav.

type PendingPicker = {
  resolve: (ref: Reference) => void
  reject: (err: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

const pendingPickers = new Map<number, PendingPicker>()

function rejectPending(tabId: number, reason: string) {
  const p = pendingPickers.get(tabId)
  if (!p) return
  pendingPickers.delete(tabId)
  clearTimeout(p.timeout)
  p.reject(new Error(reason))
}

async function startPicker(tabId: number): Promise<Reference> {
  // Cancel any in-flight pick on this tab.
  rejectPending(tabId, "superseded")

  return new Promise<Reference>((resolve, reject) => {
    const timeout = setTimeout(() => {
      rejectPending(tabId, "timeout")
      // Best-effort cancel on the content script.
      chrome.tabs.sendMessage(tabId, { type: "picker:cancel" }).catch(() => {})
    }, 60_000)
    // Register the pending entry BEFORE sending so a fast picker:captured
    // message can never race ahead of the map insert.
    pendingPickers.set(tabId, { resolve, reject, timeout })
    chrome.tabs.sendMessage(tabId, { type: "picker:start" }).catch((err) => {
      rejectPending(tabId, err?.message ?? String(err))
    })
  })
}

async function cancelPicker(tabId: number) {
  rejectPending(tabId, "cancelled")
  try {
    await chrome.tabs.sendMessage(tabId, { type: "picker:cancel" })
  } catch {
    // Content script may already be gone (navigation, tab closed).
  }
}

async function finalizeCapture(tabId: number, capture: PickerCapture) {
  const pending = pendingPickers.get(tabId)
  if (!pending) return
  pendingPickers.delete(tabId)
  clearTimeout(pending.timeout)

  try {
    const tab = await chrome.tabs.get(tabId)
    let screenshot = ""
    if (tab.windowId !== undefined) {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png"
        })
        screenshot = await cropScreenshotDataUrl(
          dataUrl,
          capture.boundingBox,
          capture.devicePixelRatio
        )
      } catch (err) {
        console.warn("picker: captureVisibleTab failed:", err)
      }
    }

    const ref: Reference = {
      id: `ref_${ulid()}`,
      tabId,
      url: tab.url || "",
      title: tab.title || "",
      selector: capture.selector,
      outerHTML: capture.outerHTML,
      textContent: capture.textContent,
      boundingBox: capture.boundingBox,
      screenshot,
      createdAt: Date.now()
    }
    pending.resolve(ref)
  } catch (err) {
    pending.reject(err instanceof Error ? err : new Error(String(err)))
  }
}

// Auto-cancel picker if the user navigates the tab away.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && pendingPickers.has(tabId)) {
    rejectPending(tabId, "navigation")
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  rejectPending(tabId, "tab-closed")
})

// Side panel behavior — open on action click
chrome.action.onClicked.addListener((tab) => {
  if (tab.windowId) {
    chrome.sidePanel.open({ windowId: tab.windowId })
  }
})

// Enable side panel on all sites
chrome.sidePanel.setOptions({
  enabled: true
})

// Detach the default popup so a toolbar click goes straight to the
// onClicked listener above (which opens the sidebar). The popup is
// re-attached only while a recording is active — see setRecordingBadge.
// Plasmo wires `default_popup: "popup.html"` automatically because
// src/popup.tsx exists; this clears it at runtime. setPopup is
// persistent, so we only need this on install + browser start.
chrome.action.setPopup({ popup: "" })
chrome.runtime.onStartup.addListener(() => {
  chrome.action.setPopup({ popup: "" })
})

// Context menu for scraping
chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setPopup({ popup: "" })
  chrome.contextMenus.create({
    id: "scrape-page",
    title: "Scrape page to AI Dev Sidebar",
    contexts: ["page"]
  })
  chrome.contextMenus.create({
    id: "send-selection",
    title: "Send selection to AI Dev",
    contexts: ["selection"]
  })
  chrome.contextMenus.create({
    id: "save-highlight",
    title: "Save highlight for review",
    contexts: ["selection"]
  })
})

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return

  if (info.menuItemId === "scrape-page") {
    const result = await scrapeTab(tab.id)
    for (const [, port] of sidebarPorts) {
      port.postMessage({ type: "scrape-result", payload: result })
    }
  }

  if (info.menuItemId === "send-selection") {
    for (const [, port] of sidebarPorts) {
      port.postMessage({
        type: "selection",
        payload: { text: info.selectionText, url: tab.url }
      })
    }
  }

  if (info.menuItemId === "save-highlight" && info.selectionText) {
    try {
      await addHighlight({
        id: crypto.randomUUID(),
        text: info.selectionText,
        sourceUrl: tab.url,
        sourceTitle: tab.title,
        createdAt: Date.now()
      })
      // A subtle badge blip to confirm capture. The ReviewPanel auto-refreshes
      // via chrome.storage.onChanged, so no port message is needed.
      chrome.action.setBadgeText({ text: "+1" })
      chrome.action.setBadgeBackgroundColor({ color: "#4ade80" })
      setTimeout(() => {
        if (!recording.active) chrome.action.setBadgeText({ text: "" })
      }, 1200)
    } catch (err) {
      console.warn("save-highlight failed:", err)
    }
  }
})

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-sidebar") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId })
    }
  }
})

// ── MCP tool bridge ──────────────────────────────────────────────────────
// The native host's MCP server dispatches tool calls that need chrome.* APIs
// here via the native port. Each tool returns a value compatible with the
// MCP `tools/call` result shape: `{ content: [{type, text}], isError? }`.
//
// M3 ships only the basics (tabs_list); M4/M5 register more.

type ToolHandler = (args: any) => Promise<any>

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  async tabs_list() {
    const tabs = await chrome.tabs.query({})
    const summary = tabs.map((t) => ({
      id: t.id,
      windowId: t.windowId,
      url: t.url,
      title: t.title,
      active: t.active,
      pinned: t.pinned,
      groupId: t.groupId
    }))
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      isError: false
    }
  },
  ...DOM_TOOL_HANDLERS,
  ...LIBRARY_TOOL_HANDLERS
}

// Wire up MCP resource publishers. Each push sends `mcp.resource.upsert`
// over the native port; the host's MCPServer mirrors it into its resources
// map, which then surfaces via tools/resources/list. Only one boot per SW.
startResourcePublishers({
  upsert: (uri, def) => {
    sendToNative({
      type: "mcp.resource.upsert",
      uri,
      name: def.name,
      description: def.description,
      mimeType: def.mimeType,
      payload: def.payload
    })
  }
})

async function handleMcpToolCall(msg: { id: number; name: string; args: any }) {
  const handler = TOOL_HANDLERS[msg.name]
  const port = nativePort ?? connectNativeHost()
  if (!port) return
  try {
    if (!handler) {
      port.postMessage({ type: "mcp.tool.result", id: msg.id, error: `unknown tool ${msg.name}` })
      return
    }
    const result = await handler(msg.args || {})
    port.postMessage({ type: "mcp.tool.result", id: msg.id, result })
  } catch (err) {
    port.postMessage({
      type: "mcp.tool.result",
      id: msg.id,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export {}
