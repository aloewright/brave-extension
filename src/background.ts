import { ulid } from "./lib/ulid";
import { cropScreenshotDataUrl } from "./lib/screenshot";
import { addHighlight } from "./review";
import { getSettings } from "./storage";
import { createSidebarApiClient } from "./lib/sidebar-api";
import { buildBrowserAgentCloudChatPayload } from "./lib/browser-agent-cloud";
import {
  addSessionSnippet,
  copyToClipboardViaTab,
} from "./lib/session-snippets";
import { DOM_TOOL_HANDLERS } from "./background/dom-tools";
import { LIBRARY_TOOL_HANDLERS } from "./background/library-tools";
import { COOKIES_TOOL_HANDLERS } from "./background/cookies-tools";
import { EXTENSIONS_TOOL_HANDLERS } from "./background/extensions-tools";
import { SEARCH_TOOL_HANDLERS } from "./background/search-tools";
import { startResourcePublishers } from "./background/resource-publishers";
import {
  ensureBookmarkSnapshot,
  pullBookmarkSnapshot,
} from "./lib/bookmark-snapshot";
import {
  recorderState,
  startRecording as startRecorderM6,
  stopRecording as stopRecorderM6,
  pauseRecording as pauseRecorderM6,
  resumeRecording as resumeRecorderM6,
  handleRecorderStopped,
  handleRecorderError,
  handleRecorderReady,
  handleMirrorMessage,
  notifyRecorderStarted,
  notifyRecorderFinalized,
  updateRecorderAction,
} from "./background/recorder";
import { RECORDER_TOOL_HANDLERS } from "./background/recorder-tools";
import {
  releaseOffscreenDocument,
  retainOffscreenDocument,
} from "./background/offscreen";
import { normalizeConsoleEntries } from "./lib/console-errors";
import {
  requestConsent,
  handleConsentResponse,
  type ConsentResponseMessage,
} from "./background/consent";
import {
  ensureThirdPartyCookieRules,
  handleThirdPartyCookieMessage,
  isThirdPartyCookieMessage,
} from "./background/third-party-cookies";
import type {
  PickerCapture,
  PickerMessage,
  Reference,
  RecorderSource,
} from "./types";

const HOST_NAME = "com.aidev.sidebar";
const HEARTBEAT_ALARM = "native-heartbeat";
const STALE_ERROR_CAPTURE_CLEANUP_KEY =
  "maintenance.errorCaptureCleanup.v1";
let nativePort: chrome.runtime.Port | null = null;
let lastDisconnectAt = 0;
const pendingCallbacks = new Map<string, (msg: any) => void>();
const pendingNativeRequests = new Map<string, (msg: any) => void>();

function safeRuntimeWarning(message: string, err?: unknown) {
  console.warn(
    `[ai-dev-sidebar] ${message}`,
    err instanceof Error ? err.message : (err ?? ""),
  );
}

function postToSidebar(port: chrome.runtime.Port, message: unknown) {
  try {
    port.postMessage(message);
    return true;
  } catch (err) {
    safeRuntimeWarning("failed to post message to sidebar port", err);
    return false;
  }
}

function postToNative(port: chrome.runtime.Port, message: unknown) {
  try {
    port.postMessage(message);
    return true;
  } catch (err) {
    safeRuntimeWarning("failed to post message to native host", err);
    if (nativePort === port) nativePort = null;
    return false;
  }
}

void ensureThirdPartyCookieRules().catch((err) => {
  safeRuntimeWarning("failed to initialize third-party cookie rules", err);
});

void ensureBookmarkSnapshot().catch((err) => {
  safeRuntimeWarning("failed to initialize bookmark snapshot", err);
});

async function reloadTabsOnceForStaleErrorCapture() {
  try {
    const stored = await chrome.storage.local.get(STALE_ERROR_CAPTURE_CLEANUP_KEY);
    if (stored?.[STALE_ERROR_CAPTURE_CLEANUP_KEY] === true) return;
    await chrome.storage.local.set({ [STALE_ERROR_CAPTURE_CLEANUP_KEY]: true });

    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs.map(async (tab) => {
        if (typeof tab.id !== "number") return;
        if (!/^https?:\/\//i.test(tab.url || "")) return;
        try {
          await chrome.tabs.reload(tab.id);
        } catch (err) {
          safeRuntimeWarning("failed to reload tab for stale content-script cleanup", err);
        }
      }),
    );
  } catch (err) {
    safeRuntimeWarning("failed to run stale error-capture cleanup", err);
  }
}

void reloadTabsOnceForStaleErrorCapture();

chrome.runtime.onMessageExternal?.addListener(
  (_message, _sender, sendResponse) => {
    sendResponse(undefined);
    return false;
  },
);

chrome.runtime.onConnectExternal?.addListener((port) => {
  port.disconnect();
});

// PTY sessions currently live in the native host. The keepalive is anchored to
// normal browser windows, not the sidepanel UI, so closing the sidebar does not
// tear down shells / dev servers that are still running in the host process.
// The PTY set is retained as a fallback signal when the windows API is late or
// unavailable, and as lifecycle evidence for clearing stale sessions after a
// native-host disconnect.
const activePtySessions = new Set<string>();
const normalBrowserWindowIds = new Set<number>();
const TERMINAL_KEEPALIVE_START = "TERMINAL_KEEPALIVE_START";
const TERMINAL_KEEPALIVE_STOP = "TERMINAL_KEEPALIVE_STOP";
let terminalKeepAliveActive = false;
let normalWindowSyncPromise: Promise<void> | null = null;
let normalWindowTrackingReady = false;

function shouldKeepNativeHostAlive() {
  return (
    normalBrowserWindowIds.size > 0 ||
    (!normalWindowTrackingReady && activePtySessions.size > 0)
  );
}

async function postTerminalKeepAliveCommand(type: string) {
  try {
    await chrome.runtime.sendMessage({ type });
  } catch {
    // Offscreen may still be booting or may have just been closed.
  }
}

async function startTerminalKeepAlive() {
  if (!terminalKeepAliveActive) {
    terminalKeepAliveActive = true;
    try {
      await retainOffscreenDocument("terminal-keepalive");
    } catch (err) {
      terminalKeepAliveActive = false;
      safeRuntimeWarning("failed to start terminal keepalive offscreen", err);
      return;
    }
  }
  await postTerminalKeepAliveCommand(TERMINAL_KEEPALIVE_START);
}

async function stopTerminalKeepAlive() {
  if (!terminalKeepAliveActive || shouldKeepNativeHostAlive()) return;
  terminalKeepAliveActive = false;
  await postTerminalKeepAliveCommand(TERMINAL_KEEPALIVE_STOP);
  await releaseOffscreenDocument("terminal-keepalive");
}

function pingNativeHost() {
  const port = nativePort ?? connectNativeHost();
  if (!port) return;
  postToNative(port, { type: "ping" });
}

function reconcileTerminalKeepAlive() {
  if (shouldKeepNativeHostAlive()) {
    void startTerminalKeepAlive();
    pingNativeHost();
    return;
  }
  void stopTerminalKeepAlive();
}

async function syncNormalBrowserWindows() {
  if (normalWindowSyncPromise) return normalWindowSyncPromise;
  normalWindowSyncPromise = (async () => {
    const windowsApi = chrome.windows;
    if (!windowsApi?.getAll) return;
    try {
      const windows = await windowsApi.getAll({ windowTypes: ["normal"] });
      normalBrowserWindowIds.clear();
      for (const win of windows) {
        if (win.type === "normal" && typeof win.id === "number") {
          normalBrowserWindowIds.add(win.id);
        }
      }
      normalWindowTrackingReady = true;
      reconcileTerminalKeepAlive();
    } catch (err) {
      safeRuntimeWarning("failed to sync browser windows for terminal keepalive", err);
    }
  })().finally(() => {
    normalWindowSyncPromise = null;
  });
  return normalWindowSyncPromise;
}

function trackActivePtySession(sessionId: string) {
  activePtySessions.add(sessionId);
  reconcileTerminalKeepAlive();
}

function untrackActivePtySession(sessionId: string) {
  activePtySessions.delete(sessionId);
  reconcileTerminalKeepAlive();
}

function connectNativeHost() {
  if (nativePort) return nativePort;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);

    nativePort.onMessage.addListener((msg: any) => {
      if (typeof msg?.requestId === "string") {
        const pending = pendingNativeRequests.get(msg.requestId);
        if (pending) {
          pendingNativeRequests.delete(msg.requestId);
          pending(msg);
          return;
        }
      }

      // Tool-call bridge from MCP server → background. Currently only a tiny
      // surface (tabs_list) lands here; M4/M5 expand it. Replies are sent
      // back over the same native port using mcp.tool.result.
      if (msg?.type === "mcp.tool.call") {
        void handleMcpToolCall(msg);
        return;
      }

      // Mirror PTY lifecycle into our local set so the heartbeat below
      // can keep the host alive while shells are still running.
      if (msg?.type === "pty.spawned" && typeof msg.sessionId === "string") {
        trackActivePtySession(msg.sessionId);
      } else if (
        (msg?.type === "pty.exit" || msg?.type === "pty.error") &&
        typeof msg?.sessionId === "string"
      ) {
        untrackActivePtySession(msg.sessionId);
      }

      // Forward everything else to all connected sidebar ports.
      for (const [, port] of sidebarPorts) {
        postToSidebar(port, { type: "native-response", payload: msg });
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError?.message || "disconnected";
      const now = Date.now();
      const sinceLast = now - lastDisconnectAt;
      lastDisconnectAt = now;
      console.warn("Native host disconnected:", err);
      nativePort = null;
      // PTYs only live inside the host process, so a host disconnect means
      // they're gone. Drop the tracking set, but keep the window-scoped
      // keepalive active if a normal browser window is still open.
      activePtySessions.clear();
      reconcileTerminalKeepAlive();

      // Silent auto-reconnect for transient drops (typical: SW recycled,
      // host process EOF'd, then we wake on the next message). The host
      // re-loads persisted hasSession so the CLI conversation continues.
      // Only surface the failure to the sidebar if reconnects are flapping
      // (multiple disconnects within 5s = real problem, not a recycle).
      if (sidebarPorts.size === 0 && !shouldKeepNativeHostAlive()) return;
      const reconnected = connectNativeHost();
      if (reconnected && (sinceLast > 5000 || sidebarPorts.size === 0)) return;

      for (const [, port] of sidebarPorts) {
        postToSidebar(port, { type: "native-disconnected", error: err });
      }
    });

    return nativePort;
  } catch (err) {
    console.error("Failed to connect native host:", err);
    return null;
  }
}

// Heartbeat — keep the SW alive and the native port from going idle.
// chrome.alarms wakes the SW even after it's been GC'd, at which point we
// re-establish the native connection (the host re-loads hasSession from
// disk, so chat context is preserved across SW restarts).
if (chrome.alarms?.create && chrome.alarms?.onAlarm) {
  try {
    chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 0.5 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name !== HEARTBEAT_ALARM) return;
      // Keep the host alive whenever a sidebar is connected or any normal
      // browser window is open. The latter is independent of the sidepanel
      // React lifecycle, so closing the sidebar does not let the native-host
      // PTY process idle out.
      if (!shouldKeepNativeHostAlive()) void syncNormalBrowserWindows();
      if (sidebarPorts.size === 0 && !shouldKeepNativeHostAlive()) return;
      if (shouldKeepNativeHostAlive()) void startTerminalKeepAlive();
      pingNativeHost();
    });
  } catch (err) {
    safeRuntimeWarning("failed to initialize heartbeat alarm", err);
  }
} else {
  safeRuntimeWarning(
    "chrome.alarms is unavailable; native host heartbeat disabled",
  );
}

function sendToNative(msg: any) {
  const port = connectNativeHost();
  if (port) {
    postToNative(port, msg);
  } else {
    // Notify sidebars about connection failure
    for (const [, p] of sidebarPorts) {
      postToSidebar(p, {
        type: "native-response",
        payload: {
          type: "error",
          data: "Native host not connected. Run: npm run install-host",
        },
      });
    }
  }
}

function requestNative(payload: any, timeoutMs = 2500): Promise<any> {
  const port = connectNativeHost();
  if (!port) return Promise.reject(new Error("native host not connected"));
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingNativeRequests.delete(requestId);
      reject(new Error(`${payload.type || "native request"} timed out`));
    }, timeoutMs);
    pendingNativeRequests.set(requestId, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    if (!postToNative(port, { ...payload, requestId })) {
      clearTimeout(timer);
      pendingNativeRequests.delete(requestId);
      reject(new Error("native host port is disconnected"));
    }
  });
}

// ─── Recorder state broadcasting ──────────────────────────────────────
// Recorder lifecycle lives in src/background/recorder.ts. We just wire
// runtime messages and broadcast state to connected sidebars.

function broadcastRecordingState() {
  const payload = { type: "recording-state", state: { ...recorderState } };
  for (const [, port] of sidebarPorts) {
    postToSidebar(port, payload);
  }
}

// Track sidebar connections
const sidebarPorts = new Map<string, chrome.runtime.Port>();
const terminalKeepAlivePorts = new Set<chrome.runtime.Port>();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "terminal-keepalive") {
    terminalKeepAlivePorts.add(port);

    port.onMessage.addListener((msg: any) => {
      if (msg?.type !== "terminal-keepalive-ping") return;
      if (!shouldKeepNativeHostAlive()) {
        void syncNormalBrowserWindows();
        return;
      }
      pingNativeHost();
    });

    port.onDisconnect.addListener(() => {
      terminalKeepAlivePorts.delete(port);
    });
    return;
  }

  if (port.name === "ai-dev-sidebar") {
    const id = crypto.randomUUID();
    sidebarPorts.set(id, port);
    void syncNormalBrowserWindows().then(() => {
      reconcileTerminalKeepAlive();
    });

    port.onMessage.addListener((msg: any) => {
      if (msg.type === "native-send") {
        sendToNative(msg.payload);
      }
    });

    port.onDisconnect.addListener(() => {
      sidebarPorts.delete(id);
      if (sidebarPorts.size === 0) openSidePanelWindows.clear();
    });
  }
});

void syncNormalBrowserWindows();

chrome.windows?.onCreated?.addListener?.((win) => {
  if (win.type !== "normal" || typeof win.id !== "number") return;
  normalWindowTrackingReady = true;
  normalBrowserWindowIds.add(win.id);
  reconcileTerminalKeepAlive();
});

chrome.windows?.onRemoved?.addListener?.((windowId) => {
  normalWindowTrackingReady = true;
  normalBrowserWindowIds.delete(windowId);
  if (normalBrowserWindowIds.size === 0) {
    void syncNormalBrowserWindows();
    return;
  }
  reconcileTerminalKeepAlive();
});

// Handle messages from content scripts and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "consent:response") {
    handleConsentResponse(message as ConsentResponseMessage);
    sendResponse({ ok: true });
    return;
  }

  if (isThirdPartyCookieMessage(message)) {
    handleThirdPartyCookieMessage(message)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "NATIVE_SEND") {
    sendToNative(message.payload);
    sendResponse({ ok: true });
  }

  if (message.type === "NATIVE_STATUS") {
    sendResponse({ connected: !!(nativePort ?? connectNativeHost()) });
  }

  if (message.type === "SCRAPE_TAB") {
    scrapeTab(message.tabId).then((result) => sendResponse(result));
    return true;
  }

  if (message.type === "PAGE_AGENT_OBSERVE") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId unavailable" });
      return;
    }
    pageAgentObserve(tabId)
      .then((observation) => sendResponse({ ok: true, observation }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "PAGE_AGENT_MESSAGE") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId unavailable" });
      return;
    }
    handlePageAgentMessage({
      tabId,
      sessionId: typeof message.sessionId === "string" ? message.sessionId : undefined,
      text: String(message.text || ""),
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "GET_CONSOLE_ERRORS") {
    const tabId = message.tabId;
    const errors = normalizeConsoleEntries(consoleErrors.get(tabId));
    consoleErrors.set(tabId, errors);
    sendResponse({ errors });
  }

  if (message.type === "PAGE_ERRORS") {
    const tabId = sender.tab?.id;
    const next = normalizeConsoleEntries(message.errors);
    if (next.length === 0 || typeof tabId !== "number") {
      sendResponse({ ok: true });
      return;
    }

    const existing = normalizeConsoleEntries(consoleErrors.get(tabId));
    consoleErrors.set(tabId, [...existing, ...next].slice(-100));
    sendResponse({ ok: true });
  }

  // ─── Recorder control (M6, ALO-248) ─────────────────────────────────

  if (message.type === "START_RECORDING") {
    const source = (message.source || "tab") as RecorderSource;
    startRecorderM6({ source, tabId: message.tabId }).then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "STOP_RECORDING") {
    stopRecorderM6().then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "PAUSE_RECORDING") {
    pauseRecorderM6().then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "RESUME_RECORDING") {
    resumeRecorderM6().then((result) => {
      broadcastRecordingState();
      sendResponse(result);
    });
    return true;
  }

  if (message.type === "GET_RECORDING_STATE") {
    sendResponse({ state: { ...recorderState } });
  }

  if (message.type === "SYNC_BOOKMARK_SNAPSHOT") {
    const force = message.force === true;
    (force ? pullBookmarkSnapshot() : ensureBookmarkSnapshot())
      .then((snapshot) => sendResponse({ ok: true, snapshot }))
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return true;
  }

  if (message.type === "RECORDER_READY") {
    handleRecorderReady((m) => {
      chrome.runtime.sendMessage(m).catch(() => {});
    });
    if (activePtySessions.size > 0) void startTerminalKeepAlive();
  }

  if (message.type === "RECORDER_STARTED") {
    notifyRecorderStarted(message.id);
    broadcastRecordingState();
  }

  if (
    message.type === "RECORDER_PAUSED" ||
    message.type === "RECORDER_RESUMED"
  ) {
    broadcastRecordingState();
  }

  if (message.type === "RECORDER_TICK") {
    updateRecorderAction();
  }

  if (message.type === "RECORDER_STOPPED") {
    void handleRecorderStopped(message, { sendNative: sendToNative }).then(
      () => {
        broadcastRecordingState();
      },
    );
  }

  if (
    message.type === "RECORDER_MIRROR_START" ||
    message.type === "RECORDER_MIRROR_CHUNK" ||
    message.type === "RECORDER_MIRROR_FINISH"
  ) {
    handleMirrorMessage(message, { sendNative: sendToNative });
  }

  // ─── Picker routing ─────────────────────────────────────────────────

  if (message.type === "picker:start") {
    const tabId = message.tabId;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId required" });
      return;
    }
    startPicker(tabId)
      .then((ref) => sendResponse({ ok: true, reference: ref }))
      .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "picker:cancel") {
    const tabId = message.tabId;
    if (typeof tabId === "number") {
      cancelPicker(tabId).then(() => sendResponse({ ok: true }));
      return true;
    }
    sendResponse({ ok: false, error: "tabId required" });
  }

  if (message.type === "picker:captured") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") {
      void finalizeCapture(
        tabId,
        (message as PickerMessage & { payload: PickerCapture }).payload,
      );
    }
    sendResponse({ ok: true });
  }

  if (message.type === "picker:cancelled") {
    const tabId = sender.tab?.id;
    if (typeof tabId === "number") rejectPending(tabId, "user-cancelled");
    sendResponse({ ok: true });
  }

  if (message.type === "RECORDER_ERROR") {
    handleRecorderError(message.error || "Recording failed");
    notifyRecorderFinalized(null);
    broadcastRecordingState();
  }

  // ─── Quick-actions bar (lifted from lean-extensions) ────────────────

  if (message.type === "RESOLVE_IP") {
    resolveHostname(message.hostname).then((ip) => sendResponse({ ip }));
    return true;
  }

  if (message.type === "SAVE_LINK") {
    saveLinkToLibrary(message.url, message.title).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }

  if (message.type === "GET_FEEDS") {
    // Forwarded to the page's content script if any has registered for feeds.
    // We don't yet ship a feed-detector content script in this repo, so fall
    // back to "no feeds" so the UI doesn't hang. Wire a real detector later.
    sendResponse({ feeds: [] });
    return false;
  }

  if (message.type === "TECH_DETECTED") {
    cachedTech.set(message.hostname, { techs: message.techs, ts: Date.now() });
    sendResponse({ ok: true });
  }

  if (message.type === "GET_TECH") {
    // Best-effort: if a tech-detector content script ran on the active tab and
    // posted TECH_DETECTED, return the cached result. Otherwise empty.
    const hostname =
      message.hostname ||
      (sender.tab?.url ? new URL(sender.tab.url).hostname : "");
    const entry = cachedTech.get(hostname);
    sendResponse({ techs: entry?.techs || [] });
  }
});

// Tiny in-memory caches + helpers for the quick-actions bar.
const cachedTech = new Map<string, { techs: any[]; ts: number }>();

async function pageAgentObserve(tabId: number): Promise<unknown> {
  const result = await DOM_TOOL_HANDLERS.browser_observe({ tabId });
  if (result.isError) throw new Error(result.content[0]?.text || "observe failed");
  return JSON.parse(result.content[0]?.text || "null");
}

type PageAgentAction = {
  kind?: string;
  ref?: string;
  value?: string;
  text?: string;
  reason?: string;
};

function extractPageAgentAction(plan: any): PageAgentAction | null {
  const action = plan?.action || plan?.plan?.action;
  if (!action || typeof action !== "object") return null;
  const kind = String(action.kind || action.type || "").trim().toLowerCase();
  if (!kind) return null;
  return {
    kind,
    ref: typeof action.ref === "string" ? action.ref : undefined,
    value: typeof action.value === "string" ? action.value : undefined,
    text: typeof action.text === "string" ? action.text : undefined,
    reason: typeof action.reason === "string" ? action.reason : undefined,
  };
}

function selectorForAgentAction(action: PageAgentAction, observation: any): string | null {
  const nodes = Array.isArray(observation?.nodes) ? observation.nodes : [];
  const ref = action.ref || "";
  if (!ref) return null;
  const node = nodes.find((n: any) => n?.ref === ref);
  const selector = typeof node?.selector === "string" ? node.selector.trim() : "";
  return selector || null;
}

function skippedActionResult(action: PageAgentAction, reason: string) {
  return {
    kind: action.kind || "action",
    ok: false,
    skipped: true,
    reason,
  };
}

function friendlyPageAgentActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/no such rule/i.test(message)) {
    return "the planned action did not match the current page observation";
  }
  return message || "the planned action could not be completed";
}

function parseToolJson(result: { content?: Array<{ text?: string }> }) {
  const text = result.content?.[0]?.text || "";
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

async function executePageAgentAction(
  tabId: number,
  observation: unknown,
  plan: unknown,
): Promise<null | {
  kind: string;
  toolName?: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  result?: any;
}> {
  const action = extractPageAgentAction(plan);
  if (!action?.kind) return null;
  if (["ask_user", "done", "remember", "compact"].includes(action.kind)) {
    return {
      kind: action.kind,
      ok: action.kind === "done",
      skipped: true,
      reason: action.reason || "no browser action required",
    };
  }

  let toolName: keyof typeof DOM_TOOL_HANDLERS | null = null;
  let args: Record<string, unknown> = { tabId };

  if (action.kind === "observe") {
    toolName = "browser_observe";
  } else if (action.kind === "click") {
    toolName = "click";
    const selector = selectorForAgentAction(action, observation);
    if (!selector) {
      return skippedActionResult(action, "planned click target is no longer in the page observation");
    }
    args.selector = selector;
  } else if (action.kind === "type") {
    toolName = "type";
    const selector = selectorForAgentAction(action, observation);
    if (!selector) {
      return skippedActionResult(action, "planned typing target is no longer in the page observation");
    }
    args.selector = selector;
    args.text = action.text || action.value || "";
  } else if (action.kind === "scroll") {
    toolName = "scroll_to";
    const selector = selectorForAgentAction(action, observation);
    if (!selector) {
      return skippedActionResult(action, "planned scroll target is no longer in the page observation");
    }
    args.selector = selector;
  } else if (action.kind === "wait") {
    toolName = "wait_for_selector";
    const selector = selectorForAgentAction(action, observation);
    if (!selector) {
      return skippedActionResult(action, "planned wait target is no longer in the page observation");
    }
    args.selector = selector;
    args.timeoutMs = 3000;
  } else if (action.kind === "navigate") {
    toolName = "navigate";
    args.url = action.value || action.text || "";
  }

  if (!toolName) {
    return {
      kind: action.kind,
      ok: false,
      skipped: true,
      reason: "unsupported planned action",
    };
  }

  try {
    const decision = await requestConsent({ toolName, args });
    if (decision === "deny") {
      return {
        kind: action.kind,
        toolName,
        ok: false,
        skipped: true,
        reason: "user denied tool call or approval timed out",
      };
    }

    const result = await DOM_TOOL_HANDLERS[toolName](args);
    return {
      kind: action.kind,
      toolName,
      ok: !result.isError,
      result: parseToolJson(result),
    };
  } catch (err) {
    return {
      kind: action.kind,
      toolName,
      ok: false,
      reason: friendlyPageAgentActionError(err),
    };
  }
}

function replyWithActionResult(base: string, actionResult: Awaited<ReturnType<typeof executePageAgentAction>>): string {
  if (!actionResult) return base;
  if (actionResult.skipped) {
    return `${base}\nAction: ${actionResult.kind} skipped - ${actionResult.reason || "not needed"}`;
  }
  if (!actionResult.ok) {
    return `${base}\nAction: ${actionResult.kind} failed - ${actionResult.reason || "execution failed"}`;
  }
  return `${base}\nAction: ${actionResult.kind} completed.`;
}

async function handlePageAgentMessage(input: {
  tabId: number;
  sessionId?: string;
  text: string;
}): Promise<{
  sessionId: string;
  reply: string;
  provider: string;
  observation: unknown;
  plan?: unknown;
}> {
  const text = input.text.trim();
  if (!text) throw new Error("message required");
  let observation = await pageAgentObserve(input.tabId);
  const sessionId = input.sessionId || `page_${crypto.randomUUID()}`;
  const localPlan = await requestNative(
    { type: "foundationModels.plan", objective: text, observation },
    15000,
  ).catch(() => null);
  const actionResult = await executePageAgentAction(input.tabId, observation, localPlan);
  if (actionResult?.result?.observation) observation = actionResult.result.observation;

  const settings = await getSettings();
  if (settings.sidebarSyncEnabled && settings.sidebarApiUrl) {
    try {
      const client = createSidebarApiClient(
        settings.sidebarApiToken,
        settings.sidebarApiUrl,
      );
      const res = await client.agent.chat(buildBrowserAgentCloudChatPayload({
        settings,
        sessionId,
        message: text,
        objective: text,
        observation,
      }));
      return {
        sessionId: res.session.id,
        reply: replyWithActionResult(localPlan?.ok && localPlan.reply ? localPlan.reply : res.reply, actionResult),
        provider: localPlan?.ok ? "foundation-models" : res.provider,
        observation,
        plan: localPlan?.plan || res.plan,
      };
    } catch (err) {
      safeRuntimeWarning("page agent cloud chat failed; using local fallback", err);
    }
  }

  const nodes = Array.isArray((observation as any)?.nodes)
    ? (observation as any).nodes.length
    : 0;
  const reply =
    localPlan?.ok && localPlan.reply
      ? localPlan.reply
      : [
          `Objective: ${text}`,
          `Status: observed ${nodes} visible page node${nodes === 1 ? "" : "s"}.`,
          "Plan: choose one safe browser action, request consent for write actions, then observe again.",
          "Next step: configure sidebar-api sync for persistent memory or continue locally from this page observation.",
        ].join("\n");
  return {
    sessionId,
    reply: replyWithActionResult(reply, actionResult),
    provider: localPlan?.ok ? "foundation-models" : "local-deterministic",
    observation,
    plan: localPlan?.plan || {
      objective: text,
      status: "planning",
      nextStep: "Use browser_observe output to choose one consent-gated action.",
      actionResult,
    },
  };
}

async function resolveHostname(hostname: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://dns.google/resolve?name=${encodeURIComponent(hostname)}&type=A`,
    );
    const data = await res.json();
    const answer = (data.Answer || []).find((a: any) => a.type === 1);
    return answer?.data || null;
  } catch {
    return null;
  }
}

async function saveLinkToLibrary(url: string, title: string): Promise<void> {
  const key = "lx_collectedLinks";
  const cur = await chrome.storage.local.get(key);
  const links: any[] = Array.isArray(cur[key]) ? cur[key] : [];
  const tags: string[] = [];

  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    host = "";
  }

  if (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be"
  ) {
    tags.push("youtube");
  }
  if (host === "github.com" || host.endsWith(".github.com")) tags.push("github");
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) tags.push("research");
  if (
    host === "stackoverflow.com" ||
    host.endsWith(".stackoverflow.com")
  ) {
    tags.push("stackoverflow");
  }

  links.unshift({
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `link_${Date.now()}`,
    url,
    title,
    tags,
    date: new Date().toISOString(),
  });
  await chrome.storage.local.set({ [key]: links });
}

// Console error tracking per tab
const consoleErrors = new Map<number, any[]>();

// Scrape page content
async function scrapeTab(tabId: number) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const meta: Record<string, string> = {};
        document.querySelectorAll("meta").forEach((m) => {
          const name =
            m.getAttribute("name") || m.getAttribute("property") || "";
          const content = m.getAttribute("content") || "";
          if (name && content) meta[name] = content;
        });

        const links = Array.from(document.querySelectorAll("a[href]"))
          .map((a) => ({
            href: (a as HTMLAnchorElement).href,
            text: a.textContent?.trim().slice(0, 100) || "",
          }))
          .filter((l) => l.href.startsWith("http"))
          .slice(0, 200);

        const images = Array.from(document.querySelectorAll("img[src]"))
          .map((img) => ({
            src: (img as HTMLImageElement).src,
            alt: (img as HTMLImageElement).alt || "",
          }))
          .slice(0, 100);

        // Get clean text content
        const clone = document.body.cloneNode(true) as HTMLElement;
        clone
          .querySelectorAll("script, style, nav, footer, header")
          .forEach((el) => el.remove());
        const text =
          clone.textContent?.replace(/\s+/g, " ").trim().slice(0, 30000) || "";

        return {
          url: location.href,
          title: document.title,
          text,
          html: document.documentElement.outerHTML.slice(0, 100000),
          links,
          images,
          meta,
          timestamp: Date.now(),
        };
      },
    });

    return results[0]?.result || null;
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ─── Element picker (Reference capture, ALO-243) ────────────────────────
// Sidepanel calls `picker:start` with a tabId. Background tells the
// content script to start the picker, awaits a `picker:captured` message,
// crops the visible-tab screenshot to the element's bounding box, packs a
// Reference and resolves the original sender. Auto-cancels on tab nav.

type PendingPicker = {
  resolve: (ref: Reference) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const pendingPickers = new Map<number, PendingPicker>();

function rejectPending(tabId: number, reason: string) {
  const p = pendingPickers.get(tabId);
  if (!p) return;
  pendingPickers.delete(tabId);
  clearTimeout(p.timeout);
  p.reject(new Error(reason));
}

async function startPicker(tabId: number): Promise<Reference> {
  // Cancel any in-flight pick on this tab.
  rejectPending(tabId, "superseded");

  return new Promise<Reference>((resolve, reject) => {
    const timeout = setTimeout(() => {
      rejectPending(tabId, "timeout");
      // Best-effort cancel on the content script.
      chrome.tabs.sendMessage(tabId, { type: "picker:cancel" }).catch(() => {});
    }, 60_000);
    // Register the pending entry BEFORE sending so a fast picker:captured
    // message can never race ahead of the map insert.
    pendingPickers.set(tabId, { resolve, reject, timeout });
    chrome.tabs.sendMessage(tabId, { type: "picker:start" }).catch((err) => {
      rejectPending(tabId, err?.message ?? String(err));
    });
  });
}

async function cancelPicker(tabId: number) {
  rejectPending(tabId, "cancelled");
  try {
    await chrome.tabs.sendMessage(tabId, { type: "picker:cancel" });
  } catch {
    // Content script may already be gone (navigation, tab closed).
  }
}

async function finalizeCapture(tabId: number, capture: PickerCapture) {
  const pending = pendingPickers.get(tabId);
  if (!pending) return;
  pendingPickers.delete(tabId);
  clearTimeout(pending.timeout);

  try {
    const tab = await chrome.tabs.get(tabId);
    let screenshot = "";
    if (tab.windowId !== undefined) {
      try {
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
          format: "png",
        });
        screenshot = await cropScreenshotDataUrl(
          dataUrl,
          capture.boundingBox,
          capture.devicePixelRatio,
        );
      } catch (err) {
        console.warn("picker: captureVisibleTab failed:", err);
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
      createdAt: Date.now(),
    };
    pending.resolve(ref);
  } catch (err) {
    pending.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

// Auto-cancel picker if the user navigates the tab away.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" && pendingPickers.has(tabId)) {
    rejectPending(tabId, "navigation");
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  rejectPending(tabId, "tab-closed");
});

// Side panel behavior — toolbar/shortcut clicks toggle the panel for the
// current window. Chrome added close/onOpened/onClosed after open, so keep
// runtime feature checks for older builds.
const openSidePanelWindows = new Set<number>();

function markSidePanelOpen(windowId?: number) {
  if (typeof windowId === "number") openSidePanelWindows.add(windowId);
}

function markSidePanelClosed(windowId?: number) {
  if (typeof windowId === "number") openSidePanelWindows.delete(windowId);
}

function isSidePanelOpen(windowId?: number) {
  return typeof windowId === "number" && openSidePanelWindows.has(windowId);
}

function openSidePanel(windowId?: number) {
  if (typeof windowId !== "number") return;
  const open = chrome.sidePanel?.open;
  if (!open) {
    safeRuntimeWarning("chrome.sidePanel.open is unavailable");
    return;
  }
  open({ windowId })
    .then(() => markSidePanelOpen(windowId))
    .catch((err) => {
      safeRuntimeWarning("failed to open side panel", err);
    });
}

function closeSidePanel(windowId?: number) {
  if (typeof windowId !== "number") return;
  const close = chrome.sidePanel?.close;
  if (!close) {
    safeRuntimeWarning("chrome.sidePanel.close is unavailable");
    return;
  }
  close({ windowId })
    .then(() => markSidePanelClosed(windowId))
    .catch((err) => {
      safeRuntimeWarning("failed to close side panel", err);
    });
}

function toggleSidePanel(windowId?: number) {
  if (typeof windowId !== "number") return;
  if (isSidePanelOpen(windowId)) {
    closeSidePanel(windowId);
    return;
  }
  openSidePanel(windowId);
}

chrome.action?.onClicked?.addListener((tab) => {
  toggleSidePanel(tab.windowId);
});

chrome.sidePanel?.onOpened?.addListener?.((info) => {
  markSidePanelOpen(info.windowId);
});

chrome.sidePanel?.onClosed?.addListener?.((info) => {
  markSidePanelClosed(info.windowId);
});

// Enable side panel on all sites
try {
  chrome.sidePanel?.setOptions?.({
    enabled: true,
  });
} catch (err) {
  safeRuntimeWarning("failed to enable side panel", err);
}

// Detach the default popup so a toolbar click goes straight to the
// onClicked listener above (which opens the sidebar). The popup is
// re-attached only while a recording is active — see setRecordingBadge.
// Plasmo wires `default_popup: "popup.html"` automatically because
// src/popup.tsx exists; this clears it at runtime. setPopup is
// persistent, so we only need this on install + browser start.
function clearActionPopup() {
  try {
    chrome.action?.setPopup?.({ popup: "" });
  } catch (err) {
    safeRuntimeWarning("failed to clear action popup", err);
  }
}

clearActionPopup();
chrome.runtime.onStartup.addListener(() => {
  clearActionPopup();
  void syncNormalBrowserWindows();
});

// Context menu for scraping
chrome.runtime.onInstalled.addListener(() => {
  clearActionPopup();
  void syncNormalBrowserWindows();
  void ensureThirdPartyCookieRules().catch((err) => {
    safeRuntimeWarning("failed to refresh third-party cookie rules", err);
  });
  try {
    chrome.contextMenus.create({
      id: "scrape-page",
      title: "Scrape page to Brave Dev Extension",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "send-selection",
      title: "Send selection to Brave Dev",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "save-highlight",
      title: "Save highlight for review",
      contexts: ["selection"],
    });
  } catch (err) {
    safeRuntimeWarning("failed to create context menus", err);
  }
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  if (info.menuItemId === "scrape-page") {
    const result = await scrapeTab(tab.id);
    for (const [, port] of sidebarPorts) {
      postToSidebar(port, { type: "scrape-result", payload: result });
    }
  }

  if (info.menuItemId === "send-selection") {
    for (const [, port] of sidebarPorts) {
      postToSidebar(port, {
        type: "selection",
        payload: { text: info.selectionText, url: tab.url },
      });
    }
  }

  if (info.menuItemId === "save-highlight" && info.selectionText) {
    try {
      const selection = info.selectionText;
      // ALO-470: drop the highlight into Session snippets, copy it to the
      // user's clipboard, and keep the legacy Review panel highlight write
      // for back-compat (the Inspector → Review panel still consumes
      // addHighlight via chrome.storage.onChanged).
      await Promise.all([
        addSessionSnippet({
          text: selection,
          sourceUrl: tab.url || "",
          sourceTitle: tab.title ?? null,
        }),
        addHighlight({
          id: crypto.randomUUID(),
          text: selection,
          sourceUrl: tab.url,
          sourceTitle: tab.title,
          createdAt: Date.now(),
        }),
      ]);
      // Best-effort clipboard write — privileged URLs will refuse the
      // script injection and the snippet still lands in Session.
      void copyToClipboardViaTab(tab.id, selection);
      // A subtle badge blip to confirm capture. The ReviewPanel auto-refreshes
      // via chrome.storage.onChanged, so no port message is needed.
      chrome.action.setBadgeText({ text: "+1" });
      chrome.action.setBadgeBackgroundColor({ color: "#4ade80" });
      setTimeout(() => {
        if (!recorderState.active) chrome.action.setBadgeText({ text: "" });
      }, 1200);
    } catch (err) {
      console.warn("save-highlight failed:", err);
    }
  }
});

// Keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-sidebar") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    toggleSidePanel(tab?.windowId);
  }
});

// ── MCP tool bridge ──────────────────────────────────────────────────────
// The native host's MCP server dispatches tool calls that need chrome.* APIs
// here via the native port. Each tool returns a value compatible with the
// MCP `tools/call` result shape: `{ content: [{type, text}], isError? }`.
//
// M3 ships only the basics (tabs_list); M4/M5 register more.

type ToolHandler = (args: any) => Promise<any>;

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  async tabs_list() {
    const tabs = await chrome.tabs.query({});
    const summary = tabs.map((t) => ({
      id: t.id,
      windowId: t.windowId,
      url: t.url,
      title: t.title,
      active: t.active,
      pinned: t.pinned,
      groupId: t.groupId,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      isError: false,
    };
  },
  ...DOM_TOOL_HANDLERS,
  ...LIBRARY_TOOL_HANDLERS,
  ...COOKIES_TOOL_HANDLERS,
  ...EXTENSIONS_TOOL_HANDLERS,
  ...SEARCH_TOOL_HANDLERS,
  ...RECORDER_TOOL_HANDLERS,
};

// Wire up MCP resource publishers. Each push sends `mcp.resource.upsert`
// over the native port; the host's MCPServer mirrors it into its resources
// map, which then surfaces via tools/resources/list. Only one boot per SW.
//
// The teardown returned by startResourcePublishers is captured here for
// hypothetical reload paths (e.g. settings flips that warrant a republish);
// today the SW lifecycle never invokes it — when the SW dies, listeners die
// with it, and the next wake-up re-runs this module top-to-bottom.
let stopResourcePublishers: (() => void) | undefined;
if (!stopResourcePublishers) {
  stopResourcePublishers = startResourcePublishers({
    upsert: (uri, def) => {
      sendToNative({
        type: "mcp.resource.upsert",
        uri,
        name: def.name,
        description: def.description,
        mimeType: def.mimeType,
        payload: def.payload,
      });
    },
  });
}

async function handleMcpToolCall(msg: { id: number; name: string; args: any }) {
  const handler = TOOL_HANDLERS[msg.name];
  const port = nativePort ?? connectNativeHost();
  if (!port) return;
  try {
    if (!handler) {
      postToNative(port, {
        type: "mcp.tool.result",
        id: msg.id,
        error: `unknown tool ${msg.name}`,
      });
      return;
    }
    // M7 (ALO-250): every tool dispatch flows through the consent FSM.
    // Read tools auto-allow; gated tools resolve from Settings flags;
    // write/cookies tools prompt the sidepanel and time out after 60s.
    const decision = await requestConsent({
      toolName: msg.name,
      args: msg.args,
    });
    if (decision === "deny") {
      postToNative(port, {
        type: "mcp.tool.result",
        id: msg.id,
        result: {
          isError: true,
          content: [{ type: "text", text: "user denied tool call" }],
        },
      });
      return;
    }
    const result = await handler(msg.args || {});
    postToNative(port, { type: "mcp.tool.result", id: msg.id, result });
  } catch (err) {
    postToNative(port, {
      type: "mcp.tool.result",
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export {};
