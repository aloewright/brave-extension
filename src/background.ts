import { ulid } from "./lib/ulid";
import { MENU_ID_TO_MODE } from "./lib/joplin-types";
import type { ClipMode, ClipRequest, ClipResultEvent } from "./lib/joplin-types";
import { handleClipRequest } from "./lib/joplin-clip-handler";
import { cropScreenshotDataUrl } from "./lib/screenshot";
import { addHighlight } from "./review";
import { getSettings } from "./storage";
import { createSidebarApiClient } from "./lib/sidebar-api";
import { buildBrowserAgentCloudChatPayload } from "./lib/browser-agent-cloud";
import {
  addSessionSnippet,
  copyToClipboardViaTab,
} from "./lib/session-snippets";
import {
  getMatchingPasswordLogins,
  PASSWORD_SELECTED_LOGIN_KEY,
  type PasswordLogin,
} from "./lib/passwords";
import { DOM_TOOL_HANDLERS } from "./background/dom-tools";
import { LIBRARY_TOOL_HANDLERS } from "./background/library-tools";
import { runChatTurn, stopTurn } from "./background/chat-orchestrator";
import type { ChatSendRequest, ChatStopRequest } from "./lib/ai-chat-types";
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
import { ensureCalTasksOriginRule } from "./background/cal-tasks-origin";
import {
  CAL_TASKS_API_BASE,
  fetchCalTasksViaPageContext,
  type CalTasksTabFetchResult,
} from "./background/cal-tasks-proxy";
import {
  parseProgram,
  executeProgram,
  type ProgramDeps,
  type StepEntry
} from "./background/page-agent-program";
import type {
  PickerCapture,
  PickerMessage,
  Reference,
  RecorderSource,
} from "./types";

const HOST_NAME = "com.aidev.sidebar";
const HEARTBEAT_ALARM = "native-heartbeat";

// ─── Joplin clipper integration ──────────────────────────────────────────────

async function getJoplinToken(): Promise<string> {
  const settings = await getSettings();
  return settings.joplinToken ?? "";
}

function broadcastClipResult(event: ClipResultEvent) {
  // Fire-and-forget. Receivers may not exist (sidebar closed). Errors here
  // are harmless (the well-known "Could not establish connection" when there
  // are no listeners).
  void chrome.runtime.sendMessage(event).catch(() => undefined);
}

async function dispatchClip(req: ClipRequest) {
  await handleClipRequest(req, {
    getJoplinToken,
    broadcast: broadcastClipResult,
    newId: () => ulid(),
    now: () => new Date()
  });
}

const STALE_ERROR_CAPTURE_CLEANUP_KEY =
  "maintenance.errorCaptureCleanup.v1";
const RSS_FEED_MENU_ID = "save-rss-feed";
const RSS_FEED_MENU_PREFIX = "save-rss-feed:";
// chrome.cookies.getAll({ url }) returns only cookies the browser would send
// to that URL (Domain/Path/Secure already filtered). Forward all of them —
// don't whitelist by name. better-auth uses prefixes like __Host- on HTTPS
// (e.g. __Host-better-auth.session_token) and ships a CSRF cookie checked on
// state-changing requests; a name whitelist drops both and yields 401s.
async function getCalFlyPmCookieHeader(): Promise<string | null> {
  try {
    const cookies = await chrome.cookies.getAll({ url: `${CAL_TASKS_API_BASE}/` });
    if (cookies.length === 0) return null;
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  } catch (err) {
    safeRuntimeWarning("failed to read cal.fly.pm session cookies", err);
    return null;
  }
}
let nativePort: chrome.runtime.Port | null = null;
let lastDisconnectAt = 0;
// Exponential-backoff state for native-host reconnects. Each disconnect that
// didn't deliver at least one message counts as a failure; a delivered
// message resets the counter. After RECONNECT_MAX_FAILURES rapid failures
// in a row we stop auto-retrying — the every-30s heartbeat alarm will pick
// it back up so we don't loop forever when the host is fundamentally
// unreachable (manifest missing, allowed_origins mismatch, etc.).
let reconnectFailures = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const RECONNECT_MAX_FAILURES = 6;
const pendingCallbacks = new Map<string, (msg: any) => void>();
const pendingNativeRequests = new Map<string, (msg: any) => void>();
const rssFeedContextMenuCache = new Map<number, FeedInfo[]>();

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

void ensureCalTasksOriginRule().catch((err) => {
  safeRuntimeWarning("failed to initialize cal.fly.pm origin rewrite rule", err);
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

let lastNativeMcpEnsureAt = 0;
let nativeMcpEnsurePromise: Promise<void> | null = null;
const NATIVE_MCP_ENSURE_INTERVAL_MS = 30_000;

async function ensureNativeMcpConnection(reason = "keepalive", force = false) {
  if (!shouldKeepNativeHostAlive()) return;
  const now = Date.now();
  if (!force && now - lastNativeMcpEnsureAt < NATIVE_MCP_ENSURE_INTERVAL_MS) return;
  if (nativeMcpEnsurePromise) return nativeMcpEnsurePromise;
  lastNativeMcpEnsureAt = now;
  nativeMcpEnsurePromise = (async () => {
    const port = nativePort ?? connectNativeHost();
    if (!port) return;
    try {
      const settings = await getSettings();
      postToNative(port, {
        type: "mcp.ensure",
        configPath: settings.claudeConfigPath || "~/.claude.json",
        reason,
      });
    } catch (err) {
      safeRuntimeWarning("failed to ensure path-aware native MCP registration", err);
      postToNative(port, { type: "mcp.ensure", configPath: "~/.claude.json", reason });
    }
    postToNative(port, { type: "ping" });
  })().finally(() => {
    nativeMcpEnsurePromise = null;
  });
  return nativeMcpEnsurePromise;
}

function reconcileTerminalKeepAlive() {
  if (shouldKeepNativeHostAlive()) {
    void startTerminalKeepAlive();
    void ensureNativeMcpConnection("window-keepalive");
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
      void ensureNativeMcpConnection("window-sync", true);
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
  // Backoff gate: while a scheduled retry is pending, every external caller
  // (offscreen keepalive ping, sendToNative, NATIVE_STATUS, etc.) would
  // otherwise create a parallel port that immediately disconnects — the
  // storm we used to see in the unreachable-host case. Defer to the
  // scheduled retry instead.
  if (reconnectTimer !== null) return null;
  // Give-up state: if we've burned through RECONNECT_MAX_FAILURES rapidly,
  // wait for the heartbeat window before trying again. The 30s threshold
  // matches the heartbeat alarm period, so heartbeat-initiated retries
  // pass through and reset the failure streak.
  if (
    reconnectFailures > RECONNECT_MAX_FAILURES &&
    Date.now() - lastDisconnectAt < 30_000
  ) {
    return null;
  }
  if (reconnectFailures > RECONNECT_MAX_FAILURES) reconnectFailures = 0;
  try {
    nativePort = chrome.runtime.connectNative(HOST_NAME);
    // Per-port flag — set on the first onMessage so the onDisconnect handler
    // can tell "host launched, then exited" from "host never launched."
    let receivedAnyMessage = false;

    nativePort.onMessage.addListener((msg: any) => {
      if (!receivedAnyMessage) {
        receivedAnyMessage = true;
        reconnectFailures = 0;
      }
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

      if (sidebarPorts.size === 0 && !shouldKeepNativeHostAlive()) return;

      // If this disconnect happened without us ever receiving a message,
      // the host never came up — count it as a failure for backoff
      // purposes. A connection that delivered at least one message
      // already reset the counter via onMessage above.
      if (!receivedAnyMessage) reconnectFailures += 1;

      // Surface the disconnect to the sidebar on rapid flapping
      // (two disconnects within 5s) — single transient drops are normal
      // when the SW gets recycled and the host EOFs.
      const isFlapping = sinceLast <= 5000 && reconnectFailures >= 2;
      if (isFlapping) {
        for (const [, port] of sidebarPorts) {
          postToSidebar(port, { type: "native-disconnected", error: err });
        }
      }

      // Give up after a streak of fast failures — the every-30s heartbeat
      // alarm will retry, so we don't burn CPU in a tight reconnect loop
      // when the host is fundamentally unreachable.
      if (reconnectFailures > RECONNECT_MAX_FAILURES) return;

      // Schedule reconnect with exponential backoff. Healthy reconnects
      // (post-message-received) fire immediately; failing reconnects back
      // off 500ms, 1s, 2s, 4s, 8s, 16s, capped at 30s.
      const delay =
        reconnectFailures === 0
          ? 0
          : Math.min(500 * 2 ** (reconnectFailures - 1), 30_000);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        if (sidebarPorts.size === 0 && !shouldKeepNativeHostAlive()) return;
        connectNativeHost();
      }, delay);
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
      void ensureNativeMcpConnection("heartbeat");
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
  void ensureNativeMcpConnection("window-created", true);
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
chrome.runtime.onMessage.addListener((message, _sender2, sendResponse2) => {
  const m = message as { type?: string };

  if (m.type === "joplin/clip") {
    dispatchClip(message as ClipRequest)
      .then(() => sendResponse2({ ok: true }))
      .catch((err) => sendResponse2({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }

  if (m.type === "ai-chat/send") {
    const req = message as ChatSendRequest;
    runChatTurn({
      userMessageId: req.userMessageId,
      text: req.text,
      ambient: req.ambient,
    })
      .then(() => sendResponse2({ ok: true }))
      .catch((err) =>
        sendResponse2({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true; // keep channel open for async response
  }

  if (m.type === "ai-chat/stop") {
    const req = message as ChatStopRequest;
    stopTurn(req.turnId);
    sendResponse2({ ok: true });
    return undefined;
  }

  return undefined;
});

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
    startRecorderM6({
      source,
      tabId: message.tabId,
      streamId: message.streamId,
      desktopAudio: message.desktopAudio,
    }).then((result) => {
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
    if (shouldKeepNativeHostAlive()) void startTerminalKeepAlive();
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
    saveLinkToLibrary(message.url, message.title, message.tags).then(() =>
      sendResponse({ ok: true }),
    );
    return true;
  }

  if (message.type === "GET_FEEDS") {
    const requestedTabId =
      typeof message.tabId === "number" ? message.tabId : sender.tab?.id;
    if (typeof requestedTabId !== "number") {
      sendResponse({ feeds: [] });
      return false;
    }
    chrome.tabs.sendMessage(requestedTabId, { type: "GET_FEEDS" }, (response) => {
      if (chrome.runtime.lastError) {
        sendResponse({ feeds: [] });
        return;
      }
      sendResponse({ feeds: normalizeFeeds(response?.feeds) });
    });
    return true;
  }

  if (message.type === "TASKS_API_REQUEST") {
    handleTasksApiRequest(message)
      .then((result) => sendResponse(result))
      .catch((err) => {
        sendResponse({
          ok: false,
          status: 0,
          error: err instanceof Error ? err.message : "Task request failed",
        });
      });
    return true;
  }

  if (message.type === "PASSWORDS_MATCH_LOGINS") {
    const pageUrl =
      typeof message.url === "string" ? message.url : sender.tab?.url || "";
    getAutofillMatches(pageUrl).then((matches) => sendResponse({ matches }));
    return true;
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

type LocalPlanResponse = { ok?: boolean; reply?: string; plan?: unknown } | null;

async function handlePageAgentMessage(input: {
  tabId: number;
  sessionId?: string;
  text: string;
}): Promise<{
  sessionId: string;
  reply: string;
  provider: string;
  steps: StepEntry[];
}> {
  const text = input.text.trim();
  if (!text) throw new Error("message required");
  const initialObservation = await pageAgentObserve(input.tabId);
  const sessionId = input.sessionId || `page_${crypto.randomUUID()}`;
  const localPlan = (await requestNative(
    { type: "foundationModels.plan", objective: text, observation: initialObservation },
    15000,
  ).catch(() => null)) as LocalPlanResponse;

  const programDeps: ProgramDeps = {
    runTool: async (name, args) => {
      const handler = DOM_TOOL_HANDLERS[name];
      if (!handler) return { ok: false, reason: `unknown tool ${name}` };
      const r = await handler(args);
      if (r.isError) return { ok: false, reason: r.content?.[0]?.text || "tool error" };
      const text = r.content?.[0]?.text ?? "";
      try {
        return { ok: true, data: text ? JSON.parse(text) : null };
      } catch {
        safeRuntimeWarning("page agent runTool got non-JSON output", { name });
        return { ok: true, data: null };
      }
    },
    observe: async (tabId) => {
      const obs = await pageAgentObserve(tabId);
      return (obs ?? { nodes: [] }) as Awaited<ReturnType<ProgramDeps["observe"]>>;
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now()
  };

  const program = parseProgram(localPlan?.plan ?? localPlan);
  const trace = await executeProgram(input.tabId, program, initialObservation as any, programDeps);

  const settings = await getSettings();
  if (settings.sidebarSyncEnabled && settings.sidebarApiUrl) {
    try {
      const client = createSidebarApiClient(settings.sidebarApiToken, settings.sidebarApiUrl);
      const res = await client.agent.chat(buildBrowserAgentCloudChatPayload({
        settings,
        sessionId,
        message: text,
        objective: text,
        observation: trace.finalObservation
      }));
      return {
        sessionId: res.session.id,
        reply: localPlan?.ok && localPlan.reply ? localPlan.reply : res.reply,
        provider: localPlan?.ok ? "foundation-models" : res.provider,
        steps: trace.steps
      };
    } catch (err) {
      safeRuntimeWarning("page agent cloud chat failed; using local fallback", err);
    }
  }

  const nodes = Array.isArray((trace.finalObservation as any)?.nodes)
    ? (trace.finalObservation as any).nodes.length
    : 0;
  const reply =
    localPlan?.ok && localPlan.reply
      ? localPlan.reply
      : [
          `Objective: ${text}`,
          `Status: observed ${nodes} visible page node${nodes === 1 ? "" : "s"}.`,
          "Plan: choose one safe browser action, request consent for write actions, then observe again.",
          "Next step: configure sidebar-api sync for persistent memory or continue locally from this page observation."
        ].join("\n");
  return {
    sessionId,
    reply,
    provider: localPlan?.ok ? "foundation-models" : "local-deterministic",
    steps: trace.steps
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

async function saveLinkToLibrary(
  url: string,
  title: string,
  extraTags: unknown = [],
): Promise<void> {
  const key = "lx_collectedLinks";
  const cur = await chrome.storage.local.get(key);
  const links: any[] = Array.isArray(cur[key]) ? cur[key] : [];
  const requestedTags = Array.isArray(extraTags) ? extraTags : [];
  const tags = Array.from(
    new Set(requestedTags.filter((tag) => typeof tag === "string" && tag.trim())),
  );

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

type FeedInfo = { url: string; title: string; type: "rss" | "atom" | "json" };

type TasksApiMessage = {
  path?: string;
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

function parseTasksApiResponse(
  status: number,
  ok: boolean,
  text: string,
): { ok: boolean; status: number; error?: string; data?: unknown } {
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { text };
    }
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      status,
      error:
        "Tasks auth failed. Sign in at cal.fly.pm in this browser profile, then reload tasks.",
      data,
    };
  }
  if (!ok) {
    return {
      ok: false,
      status,
      error: `Task request failed: ${status}`,
      data,
    };
  }
  return { ok: true, status, data };
}

async function fetchTasksViaServiceWorker(
  message: TasksApiMessage,
  path: string,
  method: string,
  isTasksDataPath: boolean,
) {
  const taskUrl = new URL(path, CAL_TASKS_API_BASE);
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  for (const [key, value] of Object.entries(message.init?.headers || {})) {
    if (
      (key.toLowerCase() === "content-type" ||
        key.toLowerCase() === "x-sidebar-token" ||
        key.toLowerCase() === "authorization") &&
      typeof value === "string"
    ) {
      headers[key] = value;
    }
  }
  const cookieHeader = await getCalFlyPmCookieHeader();
  if (cookieHeader) {
    headers.cookie = cookieHeader;
  }
  const settings = await getSettings().catch(() => null);
  const sidebarToken = settings?.sidebarApiToken?.trim();
  const tasksToken = settings?.tasksApiToken?.trim() || sidebarToken;
  const hasSidebarHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === "x-sidebar-token",
  );
  const hasAuthorizationHeader = Object.keys(headers).some(
    (key) => key.toLowerCase() === "authorization",
  );
  if (!cookieHeader && tasksToken && !hasSidebarHeader) {
    headers["x-sidebar-token"] = tasksToken;
  }
  if (!cookieHeader && tasksToken && !hasAuthorizationHeader) {
    headers.authorization = `Bearer ${tasksToken}`;
  }
  const init: RequestInit = {
    method,
    headers,
    credentials: "include",
  };
  if (method !== "GET" && typeof message.init?.body === "string") {
    init.body = message.init.body;
  }
  const urls: string[] = [taskUrl.toString()];
  if (isTasksDataPath) {
    urls.push(taskUrl.toString().replace("/tasks-data", "/tasks"));
  }

  for (let i = 0; i < urls.length; i++) {
    const response = await fetch(urls[i], init);
    const parsed = parseTasksApiResponse(
      response.status,
      response.ok,
      await response.text(),
    );
    if (parsed.ok) return parsed;
    if (parsed.status === 401 || parsed.status === 403) return parsed;
    const shouldTryFallback =
      i < urls.length - 1 &&
      (parsed.status === 404 || parsed.status === 405);
    if (shouldTryFallback) continue;
    return parsed;
  }

  return {
    ok: false,
    status: 500,
    error: "Task request failed: exhausted task API routes",
  };
}

async function fetchTasksViaCalTab(
  message: TasksApiMessage,
  path: string,
  method: string,
  isTasksDataPath: boolean,
) {
  const requestHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(message.init?.headers || {})) {
    if (key.toLowerCase() === "content-type" && typeof value === "string") {
      requestHeaders[key] = value;
    }
  }
  const body =
    method !== "GET" && typeof message.init?.body === "string"
      ? message.init.body
      : undefined;

  const paths = [path];
  if (isTasksDataPath) {
    paths.push(path.replace("/tasks-data", "/tasks"));
  }

  let ephemeralTabId: number | null = null;
  try {
    for (let i = 0; i < paths.length; i++) {
      let tabResult: CalTasksTabFetchResult | null = null;
      try {
        tabResult = await fetchCalTasksViaPageContext({
          path: paths[i],
          method,
          headers: requestHeaders,
          body,
          onEphemeralTab: (tabId) => {
            ephemeralTabId = tabId;
          },
        });
      } catch (err) {
        safeRuntimeWarning("cal.fly.pm tab task fetch failed", err);
        return null;
      }
      if (!tabResult) return null;

      const parsed = parseTasksApiResponse(
        tabResult.status,
        tabResult.ok,
        tabResult.text,
      );
      if (parsed.ok) return parsed;
      if (parsed.status === 401 || parsed.status === 403) return parsed;
      const shouldTryFallback =
        i < paths.length - 1 &&
        (parsed.status === 404 || parsed.status === 405);
      if (shouldTryFallback) continue;
      return parsed;
    }
  } finally {
    if (ephemeralTabId != null) {
      chrome.tabs.remove(ephemeralTabId).catch(() => {});
    }
  }

  return {
    ok: false,
    status: 500,
    error: "Task request failed: exhausted task API routes",
  };
}

async function handleTasksApiRequest(message: TasksApiMessage) {
  const path = typeof message.path === "string" ? message.path : "";
  const isTasksDataPath = path.startsWith("/tasks-data");
  const isTasksPath = path.startsWith("/tasks");
  if (!isTasksDataPath && !isTasksPath) {
    return { ok: false, status: 400, error: "Unsupported task API path" };
  }
  const method = (message.init?.method || "GET").toUpperCase();
  if (!["GET", "POST", "DELETE"].includes(method)) {
    return { ok: false, status: 405, error: "Unsupported task API method" };
  }
  const taskUrl = new URL(path, CAL_TASKS_API_BASE);
  if (
    taskUrl.origin !== CAL_TASKS_API_BASE ||
    (!(
      taskUrl.pathname === "/tasks-data" ||
      taskUrl.pathname.startsWith("/tasks-data/") ||
      taskUrl.pathname === "/tasks" ||
      taskUrl.pathname.startsWith("/tasks/")
    ))
  ) {
    return { ok: false, status: 400, error: "Unsupported task API path" };
  }

  const cookieHeader = await getCalFlyPmCookieHeader();
  if (cookieHeader) {
    const tabResult = await fetchTasksViaCalTab(
      message,
      path,
      method,
      isTasksDataPath,
    );
    if (tabResult) return tabResult;
  }

  return fetchTasksViaServiceWorker(message, path, method, isTasksDataPath);
}

function normalizeFeeds(feeds: unknown): FeedInfo[] {
  if (!Array.isArray(feeds)) return [];
  return feeds
    .map((feed) => {
      if (!feed || typeof feed !== "object") return null;
      const candidate = feed as Partial<FeedInfo>;
      if (!candidate.url || typeof candidate.url !== "string") return null;
      const type =
        candidate.type === "atom" || candidate.type === "json" ? candidate.type : "rss";
      return {
        url: candidate.url,
        title:
          typeof candidate.title === "string" && candidate.title.trim()
            ? candidate.title.trim()
            : candidate.url,
        type,
      };
    })
    .filter((feed): feed is FeedInfo => Boolean(feed));
}

async function getFeedsForTab(tabId: number): Promise<FeedInfo[]> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: "GET_FEEDS" }, (response) => {
      if (chrome.runtime.lastError) {
        resolve([]);
        return;
      }
      resolve(normalizeFeeds(response?.feeds));
    });
  });
}

async function getAutofillMatches(pageUrl: string): Promise<PasswordLogin[]> {
  if (!/^https?:\/\//i.test(pageUrl)) return [];
  const matches = await getMatchingPasswordLogins(pageUrl);
  if (matches.length <= 1) return matches;
  const selected = await chrome.storage.local.get(PASSWORD_SELECTED_LOGIN_KEY);
  const selectedId = selected[PASSWORD_SELECTED_LOGIN_KEY];
  if (typeof selectedId !== "string") return matches.map(withoutPassword);
  const selectedMatch = matches.find((match) => match.id === selectedId);
  return selectedMatch ? [selectedMatch] : matches.map(withoutPassword);
}

function withoutPassword(login: PasswordLogin): PasswordLogin {
  return { ...login, password: "" };
}

async function rebuildRssFeedContextMenu(tabId: number) {
  const feeds = await getFeedsForTab(tabId);
  rssFeedContextMenuCache.set(tabId, feeds);
  await removeRssFeedContextMenuItems();
  if (feeds.length === 0) {
    chrome.contextMenus.create({
      id: `${RSS_FEED_MENU_PREFIX}none`,
      parentId: RSS_FEED_MENU_ID,
      title: "No RSS feeds found",
      contexts: ["page"],
      enabled: false,
    });
  } else {
    feeds.slice(0, 20).forEach((feed, index) => {
      chrome.contextMenus.create({
        id: `${RSS_FEED_MENU_PREFIX}${index}`,
        parentId: RSS_FEED_MENU_ID,
        title: feed.title || feed.url,
        contexts: ["page"],
      });
    });
  }
  (chrome.contextMenus as any).refresh?.();
}

async function removeRssFeedContextMenuItems() {
  await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      removeContextMenuItem(`${RSS_FEED_MENU_PREFIX}${index}`),
    ).concat(removeContextMenuItem(`${RSS_FEED_MENU_PREFIX}none`)),
  );
}

async function removeContextMenuItem(id: string) {
  try {
    await chrome.contextMenus.remove(id);
  } catch {
    // Dynamic RSS child menu items may not exist yet.
  }
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
      id: "save-highlight",
      title: "Save snippet",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: RSS_FEED_MENU_ID,
      title: "Save RSS feed...",
      contexts: ["page"],
    });
    // Joplin clipper — parent + mode submenus
    chrome.contextMenus.create({
      id: "joplin-clip",
      title: "Clip to Joplin",
      contexts: ["page", "selection"],
    });
    chrome.contextMenus.create({
      id: "joplin-clip-simplified",
      parentId: "joplin-clip",
      title: "Simplified page",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "joplin-clip-full",
      parentId: "joplin-clip",
      title: "Full HTML",
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "joplin-clip-selection",
      parentId: "joplin-clip",
      title: "Selection",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "joplin-clip-url",
      parentId: "joplin-clip",
      title: "URL + title",
      contexts: ["page"],
    });
  } catch (err) {
    safeRuntimeWarning("failed to create context menus", err);
  }
});

(chrome.contextMenus as any).onShown?.addListener((info: { contexts?: string[] }, tab?: chrome.tabs.Tab) => {
  if (!info.contexts?.includes("page") || typeof tab?.id !== "number") return;
  void rebuildRssFeedContextMenu(tab.id);
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  // Joplin clipper — dispatch to handleClipRequest via dispatchClip.
  const mode: ClipMode | undefined = MENU_ID_TO_MODE[String(info.menuItemId)];
  if (mode) {
    await dispatchClip({ type: "joplin/clip", mode, tabId: tab.id });
    return;
  }

  if (info.menuItemId === "scrape-page") {
    const result = await scrapeTab(tab.id);
    for (const [, port] of sidebarPorts) {
      postToSidebar(port, { type: "scrape-result", payload: result });
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

  if (typeof info.menuItemId === "string" && info.menuItemId.startsWith(RSS_FEED_MENU_PREFIX)) {
    try {
      const feedIndex = Number.parseInt(
        info.menuItemId.slice(RSS_FEED_MENU_PREFIX.length),
        10,
      );
      const selectedFeed = rssFeedContextMenuCache.get(tab.id)?.[feedIndex];
      if (!selectedFeed) return;
      await saveLinkToLibrary(selectedFeed.url, selectedFeed.title, [
        "feed",
        selectedFeed.type,
      ]);
      chrome.action.setBadgeText({ text: "RSS" });
      chrome.action.setBadgeBackgroundColor({ color: "#f97316" });
      setTimeout(() => {
        if (!recorderState.active) chrome.action.setBadgeText({ text: "" });
      }, 1200);
    } catch (err) {
      console.warn("save-rss-feed failed:", err);
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
