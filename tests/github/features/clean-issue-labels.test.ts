import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/clean-issue-labels"

beforeEach(() => {
  document.head.innerHTML = ""
})

describe("clean-issue-labels", () => {
  it("metadata", () => {
    expect(feature.id).toBe("clean-issue-labels")
    expect(feature.category).toBe("issues")
    expect(feature.defaultEnabled).toBe(true)
    // pageTest is () => true — matches everywhere
    expect(feature.pageTest(new URL("https://github.com/o/r/issues"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pulls"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/"))).toBe(true)
  })

  it("init injects a keyed style and abort removes it", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector('style[data-rgh="clean-issue-labels"]')).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector('style[data-rgh="clean-issue-labels"]')).toBeNull()
  })

  it("init is idempotent — calling twice only injects one style tag", () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    feature.init(ctrl1.signal)
    feature.init(ctrl2.signal)
    expect(document.querySelectorAll('style[data-rgh="clean-issue-labels"]').length).toBe(1)
    ctrl1.abort()
    ctrl2.abort()
  })
})
