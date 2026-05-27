import { describe, expect, it, beforeEach, afterEach, vi } from "vitest"

// Regression test: concurrent invocations of ensure*Rule must serialize.
// Reproduces the SW console warning:
//   "Rule with id 410000 does not have a unique ID."
// caused by the top-level void ensureThirdPartyCookieRules() (SW startup)
// racing with the onInstalled-triggered call on extension reload.

type DnrRule = { id: number; priority: number; action: unknown; condition: unknown }

function makeChromeMock() {
  const state = new Map<number, DnrRule>()
  const calls: Array<{ removeRuleIds?: number[]; addRules?: DnrRule[] }> = []

  // Real Chrome rejects with this exact phrase when you try to add a rule id
  // that is already present without including it in removeRuleIds.
  function updateDynamicRules({
    removeRuleIds = [],
    addRules = [],
  }: {
    removeRuleIds?: number[]
    addRules?: DnrRule[]
  }): Promise<void> {
    calls.push({ removeRuleIds: [...removeRuleIds], addRules: addRules.map((r) => ({ ...r })) })
    return new Promise((resolve, reject) => {
      // Defer one microtask to let the await yield, the way the real API does.
      queueMicrotask(() => {
        for (const id of removeRuleIds) state.delete(id)
        for (const rule of addRules) {
          if (state.has(rule.id)) {
            reject(new Error(`Rule with id ${rule.id} does not have a unique ID.`))
            return
          }
          state.set(rule.id, rule)
        }
        resolve()
      })
    })
  }

  function getDynamicRules(): Promise<DnrRule[]> {
    return Promise.resolve(Array.from(state.values()))
  }

  const chromeStub = {
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
    },
    declarativeNetRequest: {
      updateDynamicRules,
      getDynamicRules,
    },
    // privacy + contentSettings are optional in the impl; leave undefined.
  } as unknown as typeof chrome

  return { chromeStub, state, calls }
}

describe("DNR rule registration is race-safe", () => {
  const originalChrome = (globalThis as { chrome?: unknown }).chrome

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    ;(globalThis as { chrome?: unknown }).chrome = originalChrome
  })

  it("ensureThirdPartyCookieRules serializes concurrent callers", async () => {
    const { chromeStub, state, calls } = makeChromeMock()
    ;(globalThis as { chrome?: unknown }).chrome = chromeStub

    const mod = await import("../src/background/third-party-cookies")

    await Promise.all([mod.ensureThirdPartyCookieRules(), mod.ensureThirdPartyCookieRules()])

    // Both should have succeeded — no rejection from the duplicate-id check.
    // The block rule (id 410000) should be present exactly once.
    const blockRules = Array.from(state.values()).filter((r) => r.id === 410_000)
    expect(blockRules).toHaveLength(1)

    // Both calls should have hit updateDynamicRules (no coalescing) and the
    // second call should have seen the first call's rule and included it in
    // removeRuleIds, proving the calls ran sequentially.
    expect(calls.length).toBe(2)
    expect(calls[1].removeRuleIds).toContain(410_000)
  })

  it("ensureCalTasksOriginRule serializes concurrent callers", async () => {
    const { chromeStub, state, calls } = makeChromeMock()
    ;(globalThis as { chrome?: unknown }).chrome = chromeStub

    const mod = await import("../src/background/cal-tasks-origin")

    await Promise.all([mod.ensureCalTasksOriginRule(), mod.ensureCalTasksOriginRule()])

    const calRules = Array.from(state.values()).filter((r) => r.id === 411_000)
    expect(calRules).toHaveLength(1)

    expect(calls.length).toBe(2)
    expect(calls[1].removeRuleIds).toContain(411_000)
  })

  it("rejects a deliberate concurrent race when the lock is removed (sanity check)", async () => {
    // Drive the mock directly without the lock to confirm the mock reproduces
    // the real Chrome behaviour. If this test ever stops failing, the mock has
    // drifted from real-Chrome semantics.
    const { chromeStub } = makeChromeMock()
    ;(globalThis as { chrome?: unknown }).chrome = chromeStub
    const dnr = chromeStub.declarativeNetRequest

    const ruleA = {
      id: 999_999,
      priority: 1,
      action: { type: "allow" as const },
      condition: {},
    } as unknown as chrome.declarativeNetRequest.Rule
    await dnr.updateDynamicRules({ addRules: [ruleA] })

    await expect(
      dnr.updateDynamicRules({ addRules: [{ ...ruleA }] }),
    ).rejects.toThrow(/Rule with id 999999 does not have a unique ID/)
  })
})
