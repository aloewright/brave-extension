import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  requestConsent,
  handleConsentResponse,
  __test,
  type ConsentRequestMessage,
  EVAL_GATE_KEY,
  UNINSTALL_GATE_KEY,
  COOKIES_ALLOW_ALL_KEY
} from "../src/background/consent"

beforeEach(() => {
  __test.reset()
})

afterEach(() => {
  vi.useRealTimers()
})

function makeBroadcast() {
  const sent: ConsentRequestMessage[] = []
  return {
    sent,
    fn: (msg: ConsentRequestMessage) => {
      sent.push(msg)
    }
  }
}

describe("consent FSM", () => {
  it("read tools auto-allow without prompting", async () => {
    const b = makeBroadcast()
    const decision = await requestConsent(
      { toolName: "tabs_list" },
      { broadcast: b.fn, readFlag: async () => false }
    )
    expect(decision).toBe("allow")
    expect(b.sent).toHaveLength(0)
  })

  it("gated eval_js follows storage flag without prompting", async () => {
    const b = makeBroadcast()
    let allow = false
    const readFlag = async (k: string) => {
      expect(k).toBe(EVAL_GATE_KEY)
      return allow
    }
    expect(
      await requestConsent({ toolName: "eval_js" }, { broadcast: b.fn, readFlag })
    ).toBe("deny")
    allow = true
    expect(
      await requestConsent({ toolName: "eval_js" }, { broadcast: b.fn, readFlag })
    ).toBe("allow")
    expect(b.sent).toHaveLength(0)
  })

  it("gated extensions_uninstall reads its own flag", async () => {
    const b = makeBroadcast()
    const readFlag = async (k: string) => k === UNINSTALL_GATE_KEY
    expect(
      await requestConsent(
        { toolName: "extensions_uninstall" },
        { broadcast: b.fn, readFlag }
      )
    ).toBe("allow")
    expect(b.sent).toHaveLength(0)
  })

  it("write tool prompts and resolves with the user response", async () => {
    const b = makeBroadcast()
    const promise = requestConsent(
      { toolName: "click", args: { selector: ".btn" } },
      {
        broadcast: b.fn,
        readFlag: async () => false,
        newRequestId: () => "req-1"
      }
    )
    expect(b.sent).toHaveLength(1)
    expect(b.sent[0].toolName).toBe("click")
    expect(b.sent[0].toolClass).toBe("write")
    expect(b.sent[0].requestId).toBe("req-1")

    handleConsentResponse({
      type: "consent:response",
      requestId: "req-1",
      decision: "allow",
      remember: false
    })
    expect(await promise).toBe("allow")
  })

  it("session-remember caches subsequent calls to the same write tool", async () => {
    const b = makeBroadcast()
    const p1 = requestConsent(
      { toolName: "type", args: { selector: "#x" } },
      { broadcast: b.fn, readFlag: async () => false, newRequestId: () => "r1" }
    )
    handleConsentResponse({
      type: "consent:response",
      requestId: "r1",
      decision: "allow",
      remember: true
    })
    expect(await p1).toBe("allow")
    expect(__test.hasCached("type")).toBe(true)

    // Second call must skip prompting entirely.
    const before = b.sent.length
    const decision = await requestConsent(
      { toolName: "type", args: { selector: "#y" } },
      { broadcast: b.fn, readFlag: async () => false }
    )
    expect(decision).toBe("allow")
    expect(b.sent.length).toBe(before)
  })

  it("deny does not populate the session cache", async () => {
    const b = makeBroadcast()
    const p = requestConsent(
      { toolName: "click" },
      { broadcast: b.fn, readFlag: async () => false, newRequestId: () => "rd" }
    )
    handleConsentResponse({
      type: "consent:response",
      requestId: "rd",
      decision: "deny",
      remember: true
    })
    expect(await p).toBe("deny")
    expect(__test.hasCached("click")).toBe(false)
  })

  it("cookies_* always prompts (no session cache) unless allow-all", async () => {
    const b = makeBroadcast()
    // First call — user allows + checks remember; cache MUST NOT take.
    const p1 = requestConsent(
      { toolName: "cookies_get" },
      { broadcast: b.fn, readFlag: async () => false, newRequestId: () => "c1" }
    )
    // Yield so the readFlag promise resolves and broadcast fires.
    await Promise.resolve()
    await Promise.resolve()
    expect(b.sent[0].toolClass).toBe("always-prompt")
    handleConsentResponse({
      type: "consent:response",
      requestId: "c1",
      decision: "allow",
      remember: true
    })
    expect(await p1).toBe("allow")
    expect(__test.hasCached("cookies_get")).toBe(false)

    // Second call still prompts.
    const before = b.sent.length
    const p2 = requestConsent(
      { toolName: "cookies_get" },
      { broadcast: b.fn, readFlag: async () => false, newRequestId: () => "c2" }
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(b.sent.length).toBe(before + 1)
    handleConsentResponse({
      type: "consent:response",
      requestId: "c2",
      decision: "deny",
      remember: false
    })
    expect(await p2).toBe("deny")

    // Allow-all override skips prompting entirely.
    const before2 = b.sent.length
    const p3 = await requestConsent(
      { toolName: "cookies_set" },
      {
        broadcast: b.fn,
        readFlag: async (k) => k === COOKIES_ALLOW_ALL_KEY
      }
    )
    expect(p3).toBe("allow")
    expect(b.sent.length).toBe(before2)
  })

  it("times out and denies if no response arrives", async () => {
    vi.useFakeTimers()
    const b = makeBroadcast()
    const p = requestConsent(
      { toolName: "click" },
      {
        broadcast: b.fn,
        readFlag: async () => false,
        newRequestId: () => "to-1",
        timeoutMs: 5_000
      }
    )
    expect(b.sent).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await p).toBe("deny")
  })

  it("captures_list and captures_get auto-allow as read-class", async () => {
    const b = makeBroadcast()
    expect(
      await requestConsent(
        { toolName: "captures_list" },
        { broadcast: b.fn, readFlag: async () => false }
      )
    ).toBe("allow")
    expect(
      await requestConsent(
        { toolName: "captures_get", args: { id: "x" } },
        { broadcast: b.fn, readFlag: async () => false }
      )
    ).toBe("allow")
    expect(b.sent).toHaveLength(0)
  })

  it("coalesces concurrent write prompts for the same tool", async () => {
    const b = makeBroadcast()
    let n = 0
    const newRequestId = () => `coal-${++n}`
    const p1 = requestConsent(
      { toolName: "bookmarks_create", args: { url: "https://a" } },
      { broadcast: b.fn, readFlag: async () => false, newRequestId }
    )
    const p2 = requestConsent(
      { toolName: "bookmarks_create", args: { url: "https://b" } },
      { broadcast: b.fn, readFlag: async () => false, newRequestId }
    )
    // Only ONE prompt should have been emitted.
    expect(b.sent).toHaveLength(1)
    expect(b.sent[0].requestId).toBe("coal-1")

    handleConsentResponse({
      type: "consent:response",
      requestId: "coal-1",
      decision: "allow",
      remember: false
    })
    const [d1, d2] = await Promise.all([p1, p2])
    expect(d1).toBe("allow")
    expect(d2).toBe("allow")
  })

  it("does NOT coalesce concurrent always-prompt cookies calls", async () => {
    const b = makeBroadcast()
    let n = 0
    const newRequestId = () => `ck-${++n}`
    const p1 = requestConsent(
      { toolName: "cookies_get", args: { name: "a" } },
      { broadcast: b.fn, readFlag: async () => false, newRequestId }
    )
    const p2 = requestConsent(
      { toolName: "cookies_get", args: { name: "b" } },
      { broadcast: b.fn, readFlag: async () => false, newRequestId }
    )
    // Yield so the readFlag promises resolve and broadcasts fire.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(b.sent).toHaveLength(2)
    expect(b.sent[0].requestId).toBe("ck-1")
    expect(b.sent[1].requestId).toBe("ck-2")

    handleConsentResponse({
      type: "consent:response",
      requestId: "ck-1",
      decision: "allow",
      remember: false
    })
    handleConsentResponse({
      type: "consent:response",
      requestId: "ck-2",
      decision: "deny",
      remember: false
    })
    expect(await p1).toBe("allow")
    expect(await p2).toBe("deny")
  })

  it("unknown tool defaults to write-class (prompts)", async () => {
    const b = makeBroadcast()
    requestConsent(
      { toolName: "totally_unknown_tool" },
      { broadcast: b.fn, readFlag: async () => false, newRequestId: () => "u1" }
    )
    expect(b.sent).toHaveLength(1)
    expect(b.sent[0].toolClass).toBe("write")
  })
})

// Tests for the defaultReadFlag simplification (PR change: removed fallback to
// ai-dev-settings object; now only reads the direct storage key).
describe("consent defaultReadFlag — direct storage key only", () => {
  beforeEach(() => {
    __test.reset()
  })

  it("grants eval_js when EVAL_GATE_KEY is set directly in storage", async () => {
    // New behavior: only checks the direct key, not ai-dev-settings.allowEvalJs
    await chrome.storage.local.set({ [EVAL_GATE_KEY]: true })
    const decision = await requestConsent({ toolName: "eval_js" })
    expect(decision).toBe("allow")
  })

  it("denies eval_js when EVAL_GATE_KEY is absent from storage", async () => {
    // Key not set at all → deny
    const decision = await requestConsent({ toolName: "eval_js" })
    expect(decision).toBe("deny")
  })

  it("denies eval_js even when legacy ai-dev-settings.allowEvalJs is true", async () => {
    // Old code checked ai-dev-settings.allowEvalJs; new code does NOT
    await chrome.storage.local.set({
      "ai-dev-settings": { allowEvalJs: true }
    })
    const decision = await requestConsent({ toolName: "eval_js" })
    // Should be "deny" because EVAL_GATE_KEY itself is not set
    expect(decision).toBe("deny")
  })

  it("grants extensions_uninstall when UNINSTALL_GATE_KEY is set directly", async () => {
    await chrome.storage.local.set({ [UNINSTALL_GATE_KEY]: true })
    const decision = await requestConsent({ toolName: "extensions_uninstall" })
    expect(decision).toBe("allow")
  })

  it("denies extensions_uninstall when legacy ai-dev-settings.allowExtensionUninstall is true but direct key absent", async () => {
    await chrome.storage.local.set({
      "ai-dev-settings": { allowExtensionUninstall: true }
    })
    const decision = await requestConsent({ toolName: "extensions_uninstall" })
    expect(decision).toBe("deny")
  })

  it("skips cookies prompt when COOKIES_ALLOW_ALL_KEY is set directly", async () => {
    await chrome.storage.local.set({ [COOKIES_ALLOW_ALL_KEY]: true })
    const b = makeBroadcast()
    const decision = await requestConsent(
      { toolName: "cookies_get" },
      { broadcast: b.fn }
    )
    expect(decision).toBe("allow")
    expect(b.sent).toHaveLength(0)
  })

  it("denies cookies allow-all when only legacy ai-dev-settings.cookiesAllowAll is set", async () => {
    // Old code checked ai-dev-settings.cookiesAllowAll; new code does NOT
    await chrome.storage.local.set({
      "ai-dev-settings": { cookiesAllowAll: true }
    })
    const b = makeBroadcast()
    // Should prompt (not auto-allow), so we immediately deny via timeout
    vi.useFakeTimers()
    const p = requestConsent(
      { toolName: "cookies_get" },
      { broadcast: b.fn, timeoutMs: 100 }
    )
    await vi.advanceTimersByTimeAsync(200)
    const decision = await p
    vi.useRealTimers()
    // With old behavior this would have been "allow"; new behavior prompts → timeout → deny
    expect(decision).toBe("deny")
    expect(b.sent.length).toBeGreaterThan(0)
  })
})
