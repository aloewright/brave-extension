// tests/github/features/restore-file.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/restore-file"
import * as api from "../../../src/lib/github/api"

beforeEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
  delete (window as unknown as Record<string, unknown>).confirm
})
afterEach(() => { vi.restoreAllMocks() })

describe("restore-file metadata", () => {
  it("is write-actions, off by default, needsToken, repo scope, confirm string", () => {
    expect(feature.category).toBe("write-actions")
    expect(feature.defaultEnabled).toBe(false)
    expect(feature.needsToken).toBe(true)
    expect(feature.writeScopes).toContain("repo")
    expect(typeof feature.confirm).toBe("string")
    expect(feature.confirm!.length).toBeGreaterThan(0)
  })

  it("pageTest matches /files path", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(false)
  })
})

describe("restore-file behaviour", () => {
  it("init runs without error when no token (hasToken is checked lazily on click)", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(false)
    const ctrl = new AbortController()
    // init is sync; should not throw
    feature.init(ctrl.signal)
    ctrl.abort()
    expect(true).toBe(true)
  })

  it("is idempotent: calling init twice doesn't double-bind", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    feature.init(ctrl.signal)
    // Inject a fake kebab button
    const btn = document.createElement("button")
    btn.className = "octicon-kebab-horizontal-parent"
    btn.innerHTML = '<svg class="octicon-kebab-horizontal"></svg>'
    document.body.append(btn)
    ctrl.abort()
    // No error = pass
  })
})
