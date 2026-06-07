import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/show-whitespace-toggle"

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = ""
})

describe("show-whitespace-toggle", () => {
  it("metadata", () => {
    expect(feature.id).toBe("show-whitespace-toggle")
    expect(feature.category).toBe("pull-requests")
    expect(feature.defaultEnabled).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/commit/abc123"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r"))).toBe(false)
  })

  it("init injects a keyed style and abort removes it", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector('style[data-rgh="show-whitespace-toggle"]')).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector('style[data-rgh="show-whitespace-toggle"]')).toBeNull()
  })

  it("init is idempotent — calling twice only injects one style tag", () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    feature.init(ctrl1.signal)
    feature.init(ctrl2.signal)
    expect(document.querySelectorAll('style[data-rgh="show-whitespace-toggle"]').length).toBe(1)
    ctrl1.abort()
    ctrl2.abort()
  })
})
