// tests/github/features/clean-sidebar.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/clean-sidebar"

beforeEach(() => { document.head.innerHTML = "" })

describe("clean-sidebar", () => {
  it("metadata", () => {
    expect(feature.id).toBe("clean-sidebar")
    expect(feature.category).toBe("global")
    expect(feature.defaultEnabled).toBe(true)
    // pageTest is true for any URL
    expect(feature.pageTest(new URL("https://github.com/"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(true)
  })

  it("init injects a keyed style, abort removes it", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector('style[data-rgh="clean-sidebar"]')).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector('style[data-rgh="clean-sidebar"]')).toBeNull()
  })

  it("init is idempotent — double-init produces one style element", () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    feature.init(ctrl1.signal)
    feature.init(ctrl2.signal)
    expect(document.querySelectorAll('style[data-rgh="clean-sidebar"]').length).toBe(1)
    ctrl1.abort()
    ctrl2.abort()
  })
})
