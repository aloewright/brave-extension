// tests/github/features/selectable-comment-quotes.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/selectable-comment-quotes"

beforeEach(() => { document.head.innerHTML = "" })

describe("selectable-comment-quotes", () => {
  it("metadata", () => {
    expect(feature.id).toBe("selectable-comment-quotes")
    expect(feature.category).toBe("global")
    expect(feature.defaultEnabled).toBe(true)
    // applies on any page
    expect(feature.pageTest(new URL("https://github.com/o/r/issues/1"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/"))).toBe(true)
  })

  it("init injects a keyed style, abort removes it", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector('style[data-rgh="selectable-comment-quotes"]')).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector('style[data-rgh="selectable-comment-quotes"]')).toBeNull()
  })

  it("init is idempotent — double-init produces one style element", () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    feature.init(ctrl1.signal)
    feature.init(ctrl2.signal)
    expect(document.querySelectorAll('style[data-rgh="selectable-comment-quotes"]').length).toBe(1)
    ctrl1.abort()
    ctrl2.abort()
  })
})
