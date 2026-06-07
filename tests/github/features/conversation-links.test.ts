// tests/github/features/conversation-links.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import feature from "../../../src/lib/github/features/conversation-links"
import * as repo from "../../../src/lib/github/repo"

beforeEach(() => {
  document.body.innerHTML = ""
  vi.spyOn(repo, "parseRepo").mockReturnValue({
    owner: "myorg", name: "myrepo", nameWithOwner: "myorg/myrepo"
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("conversation-links metadata", () => {
  it("has correct id, category, defaultEnabled, no token", () => {
    expect(feature.id).toBe("conversation-links")
    expect(feature.category).toBe("pull-requests")
    expect(feature.defaultEnabled).toBe(true)
    expect(feature.needsToken).toBeUndefined()
  })
  it("pageTest matches PR pages", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/issues/1"))).toBe(false)
    expect(feature.pageTest(new URL("https://github.com/o/r"))).toBe(false)
  })
})

describe("conversation-links behavior", () => {
  it("linkifies .branch-name elements into anchor tags", async () => {
    const branchEl = document.createElement("span")
    branchEl.className = "branch-name"
    branchEl.textContent = "feature/my-branch"
    document.body.append(branchEl)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const link = branchEl.querySelector("a")
    expect(link).not.toBeNull()
    expect(link!.href).toContain("myorg/myrepo/tree/feature%2Fmy-branch")
    expect(link!.textContent).toBe("feature/my-branch")
    ctrl.abort()
  })

  it("is idempotent — does not double-linkify .branch-name", async () => {
    const branchEl = document.createElement("span")
    branchEl.className = "branch-name"
    branchEl.textContent = "dev"
    document.body.append(branchEl)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))
    ctrl.abort()

    const ctrl2 = new AbortController()
    feature.init(ctrl2.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(branchEl.querySelectorAll("a").length).toBe(1)
    ctrl2.abort()
  })

  it("linkifies .commit-ref elements into anchor tags", async () => {
    const commitRef = document.createElement("span")
    commitRef.className = "commit-ref"
    commitRef.textContent = "main"
    document.body.append(commitRef)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const link = commitRef.querySelector("a")
    expect(link).not.toBeNull()
    expect(link!.href).toContain("myorg/myrepo/tree/main")
    ctrl.abort()
  })

  it("does not linkify elements already inside an anchor", async () => {
    const outer = document.createElement("a")
    outer.href = "https://github.com/o/r/tree/main"
    const branchEl = document.createElement("span")
    branchEl.className = "branch-name"
    branchEl.textContent = "main"
    outer.append(branchEl)
    document.body.append(outer)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    // No nested <a> should be created inside the existing <a>
    expect(branchEl.querySelector("a")).toBeNull()
    ctrl.abort()
  })

  it("never uses innerHTML — text is safe", async () => {
    const branchEl = document.createElement("span")
    branchEl.className = "branch-name"
    branchEl.textContent = "<script>alert(1)</script>"
    document.body.append(branchEl)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(branchEl.querySelector("script")).toBeNull()
    ctrl.abort()
  })
})
