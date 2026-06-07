// tests/github/features/expand-all-files.test.ts
import { describe, it, expect, beforeEach } from "vitest"
import feature from "../../../src/lib/github/features/expand-all-files"

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = ""
  document.body.classList.remove("rgh-expand-all-files")
})

describe("expand-all-files metadata", () => {
  it("has correct id, category, defaultEnabled, no token", () => {
    expect(feature.id).toBe("expand-all-files")
    expect(feature.category).toBe("repository")
    expect(feature.defaultEnabled).toBe(true)
    expect(feature.needsToken).toBeUndefined()
  })
  it("pageTest matches PR files, commit, single file", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/commit/abc123"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/blob/main/src/a.ts"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(false)
    expect(feature.pageTest(new URL("https://github.com/o/r"))).toBe(false)
  })
})

describe("expand-all-files behavior", () => {
  it("adds body class and style on init, removes on abort", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    expect(document.body.classList.contains("rgh-expand-all-files")).toBe(true)
    expect(document.querySelector(`style[data-rgh="expand-all-files"]`)).not.toBeNull()
    ctrl.abort()
    expect(document.body.classList.contains("rgh-expand-all-files")).toBe(false)
    expect(document.querySelector(`style[data-rgh="expand-all-files"]`)).toBeNull()
  })

  it("clicking a diff line triggers the native expand button", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)

    let clicked = false
    const btn = document.createElement("button")
    btn.className = "js-expand"
    btn.addEventListener("click", () => { clicked = true })

    const row = document.createElement("tr")
    row.className = "js-expandable-line"
    const diffView = document.createElement("div")
    diffView.className = "diff-view"
    diffView.append(row)
    row.append(btn)
    document.body.append(diffView)

    // Click on the row (not the button directly)
    const td = document.createElement("td")
    row.prepend(td)
    td.dispatchEvent(new MouseEvent("click", { bubbles: true }))

    expect(clicked).toBe(true)
    ctrl.abort()
  })

  it("clicking the native button directly does not double-fire", () => {
    const ctrl = new AbortController()
    feature.init(ctrl.signal)

    let clickCount = 0
    const btn = document.createElement("button")
    btn.className = "js-expand"
    btn.addEventListener("click", () => { clickCount++ })

    const row = document.createElement("tr")
    row.className = "js-expandable-line"
    const diffView = document.createElement("div")
    diffView.className = "diff-view"
    diffView.append(row)
    row.append(btn)
    document.body.append(diffView)

    // Click directly on the native button — our handler should skip
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    // Only the natural click fires, not a synthetic second one
    expect(clickCount).toBe(1)
    ctrl.abort()
  })
})
