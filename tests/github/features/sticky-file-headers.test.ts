// tests/github/features/sticky-file-headers.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/sticky-file-headers"

beforeEach(() => { document.head.innerHTML = "" })

describe("sticky-file-headers", () => {
  it("metadata", () => {
    expect(feature.id).toBe("sticky-file-headers")
    expect(feature.category).toBe("repository")
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
  })
  it("init injects a keyed style, abort removes it", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.querySelector('style[data-rgh="sticky-file-headers"]')).not.toBeNull()
    ctrl.abort()
    expect(document.querySelector('style[data-rgh="sticky-file-headers"]')).toBeNull()
  })
})
