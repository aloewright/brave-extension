// tests/github/features/hide-newsfeed-noise.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/hide-newsfeed-noise"

beforeEach(() => { document.head.innerHTML = "" })

describe("hide-newsfeed-noise", () => {
  it("metadata", () => {
    expect(feature.id).toBe("hide-newsfeed-noise")
    expect(feature.category).toBe("global")
    expect(feature.defaultEnabled).toBe(true)
  })

  it("pageTest is true only for the dashboard (root path)", () => {
    expect(feature.pageTest(new URL("https://github.com/"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r"))).toBe(false)
    expect(feature.pageTest(new URL("https://github.com/o/r/issues/1"))).toBe(false)
  })

  it("init injects a keyed style, abort removes it", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector('style[data-rgh="hide-newsfeed-noise"]')).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector('style[data-rgh="hide-newsfeed-noise"]')).toBeNull()
  })

  it("init is idempotent — double-init produces one style element", () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    feature.init(ctrl1.signal)
    feature.init(ctrl2.signal)
    expect(document.querySelectorAll('style[data-rgh="hide-newsfeed-noise"]').length).toBe(1)
    ctrl1.abort()
    ctrl2.abort()
  })
})
