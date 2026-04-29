/**
 * Consent FSM (ALO-250, M7).
 *
 * Mediates every MCP tool dispatch through a per-tool decision check.
 *
 *   read           → immediate allow
 *   gated          → look up Settings flag (no prompt)
 *   always-prompt  → prompt sidepanel every call (cookies). Optional
 *                    Settings override (cookies.allowAll) skips prompt.
 *   write          → prompt sidepanel; honour session-scoped cache when
 *                    user picks "remember for this session".
 *
 * The session cache is module-level only — it dies with the service
 * worker, which is exactly the "until SW restart" semantics the spec
 * asks for. No chrome.storage writes for the cache.
 *
 * Sidepanel comms: background broadcasts a `consent:request` runtime
 * message; sidepanel responds with `consent:response`. If no sidepanel
 * is open / no response within CONSENT_TIMEOUT_MS, the request denies.
 */

import { getToolClass } from "../lib/tool-classes"

export type ConsentDecision = "allow" | "deny"

export interface ConsentRequestMessage {
  type: "consent:request"
  requestId: string
  toolName: string
  args: unknown
  toolClass: "write" | "always-prompt"
}

export interface ConsentResponseMessage {
  type: "consent:response"
  requestId: string
  decision: ConsentDecision
  remember: boolean
}

export const EVAL_GATE_KEY = "settings.allowEvalJs"
export const UNINSTALL_GATE_KEY = "settings.allowExtensionUninstall"
export const COOKIES_ALLOW_ALL_KEY = "settings.cookies.allowAll"

export const CONSENT_TIMEOUT_MS = 60_000

interface PendingEntry {
  resolve: (d: ConsentDecision) => void
  timer: ReturnType<typeof setTimeout>
  toolName: string
  toolClass: "write" | "always-prompt"
}

// Module-level state — implicitly cleared on SW restart.
const sessionAllowCache = new Set<string>()
const pending = new Map<string, PendingEntry>()

export function clearConsentCache(): void {
  sessionAllowCache.clear()
  for (const { timer, resolve } of pending.values()) {
    clearTimeout(timer)
    resolve("deny")
  }
  pending.clear()
}

// Test seam: caller can override the message-broadcast and storage-read
// pathways. Defaults bind to chrome.* APIs at runtime.
export interface ConsentDeps {
  broadcast?: (msg: ConsentRequestMessage) => void
  readFlag?: (key: string) => Promise<boolean>
  timeoutMs?: number
  newRequestId?: () => string
}

async function defaultReadFlag(key: string): Promise<boolean> {
  try {
    const r = await chrome.storage.local.get(key)
    return !!r?.[key]
  } catch {
    return false
  }
}

function defaultBroadcast(msg: ConsentRequestMessage): void {
  // chrome.runtime.sendMessage rejects when no listener (sidepanel
  // closed) — swallow; the timeout fallback will deny.
  try {
    chrome.runtime.sendMessage(msg).catch(() => {})
  } catch {
    /* ignore */
  }
}

function defaultRequestId(): string {
  return (
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `cr_${Date.now()}_${Math.random().toString(16).slice(2)}`
  )
}

function gateKeyFor(toolName: string): string | null {
  if (toolName === "eval_js") return EVAL_GATE_KEY
  if (toolName === "extensions_uninstall") return UNINSTALL_GATE_KEY
  return null
}

export interface ConsentRequest {
  toolName: string
  args?: unknown
}

export function getConsentClass(toolName: string) {
  return getToolClass(toolName)
}

export async function requestConsent(
  req: ConsentRequest,
  deps: ConsentDeps = {}
): Promise<ConsentDecision> {
  const cls = getToolClass(req.toolName)
  const readFlag = deps.readFlag ?? defaultReadFlag
  const broadcast = deps.broadcast ?? defaultBroadcast
  const timeoutMs = deps.timeoutMs ?? CONSENT_TIMEOUT_MS
  const newRequestId = deps.newRequestId ?? defaultRequestId

  if (cls === "read") return "allow"

  if (cls === "gated") {
    const key = gateKeyFor(req.toolName)
    if (!key) return "deny"
    return (await readFlag(key)) ? "allow" : "deny"
  }

  if (cls === "always-prompt") {
    // Cookies. Honour the optional permanent allow-all override.
    if (await readFlag(COOKIES_ALLOW_ALL_KEY)) return "allow"
    return promptUser("always-prompt", req, broadcast, timeoutMs, newRequestId)
  }

  // "write" — session-cache aware.
  if (sessionAllowCache.has(req.toolName)) return "allow"
  return promptUser("write", req, broadcast, timeoutMs, newRequestId)
}

function promptUser(
  cls: "write" | "always-prompt",
  req: ConsentRequest,
  broadcast: (msg: ConsentRequestMessage) => void,
  timeoutMs: number,
  newRequestId: () => string
): Promise<ConsentDecision> {
  const requestId = newRequestId()

  return new Promise<ConsentDecision>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve("deny")
    }, timeoutMs)
    pending.set(requestId, {
      resolve,
      timer,
      toolName: req.toolName,
      toolClass: cls
    })

    broadcast({
      type: "consent:request",
      requestId,
      toolName: req.toolName,
      args: req.args ?? {},
      toolClass: cls
    })
  })
}

/**
 * Sidepanel response handler — wired into chrome.runtime.onMessage.
 * Returns true if the message matched a pending request.
 */
export function handleConsentResponse(msg: ConsentResponseMessage): boolean {
  if (!msg || msg.type !== "consent:response") return false
  const entry = pending.get(msg.requestId)
  if (!entry) return false
  pending.delete(msg.requestId)
  clearTimeout(entry.timer)
  // Session-remember is only meaningful for "write" — cookies are
  // intentionally always-prompt unless overridden in Settings.
  if (
    msg.decision === "allow" &&
    msg.remember &&
    entry.toolClass === "write"
  ) {
    sessionAllowCache.add(entry.toolName)
  }
  entry.resolve(msg.decision)
  return true
}

export const __test = {
  hasCached: (name: string) => sessionAllowCache.has(name),
  pendingSize: () => pending.size,
  reset: () => {
    sessionAllowCache.clear()
    for (const { timer } of pending.values()) clearTimeout(timer)
    pending.clear()
  }
}
