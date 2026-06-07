// tests/github/features/quick-review.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/quick-review"
import * as api from "../../../src/lib/github/api"

beforeEach(() => {
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  vi.restoreAllMocks()
})
afterEach(() => { vi.restoreAllMocks() })

describe("quick-review metadata", () => {
  it("is write-actions, off by default, needsToken false, confirm string", () => {
    expect(feature.category).toBe("write-actions")
    expect(feature.defaultEnabled).toBe(false)
    expect(feature.needsToken).toBe(false)
    expect(typeof feature.confirm).toBe("string")
    expect(feature.confirm!.length).toBeGreaterThan(0)
  })

  it("pageTest matches PR and PR files pages", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/issues/1"))).toBe(false)
  })
})

describe("quick-review behaviour", () => {
  it("injects review now link in sidebar reviewers heading", async () => {
    const reviewersSection = document.createElement("div")
    reviewersSection.className = "discussion-sidebar-heading"
    const menu = document.createElement("div")
    menu.id = "reviewers-select-menu"
    menu.append(reviewersSection)
    document.body.append(menu)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(reviewersSection.querySelector(".rgh-quick-review")).toBeTruthy()
    ctrl.abort()
  })

  it("is idempotent: re-init doesn't add a second review link", async () => {
    const reviewersSection = document.createElement("div")
    reviewersSection.className = "discussion-sidebar-heading"
    const menu = document.createElement("div")
    menu.id = "reviewers-select-menu"
    menu.append(reviewersSection)
    document.body.append(menu)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(reviewersSection.querySelectorAll(".rgh-quick-review").length).toBe(1)
    ctrl.abort()
  })

  it("calls v3 POST with alt-click (skips prompt) to approve", async () => {
    const postSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)
    vi.spyOn(window, "location", "get").mockReturnValue({
      pathname: "/o/r/pull/5",
      href: "https://github.com/o/r/pull/5",
      reload: vi.fn(),
    } as unknown as Location)

    const meta = document.createElement("meta")
    meta.setAttribute("name", "user-login")
    meta.setAttribute("content", "viewer")
    document.head.append(meta)
    const authorEl = document.createElement("a")
    authorEl.className = "author"
    authorEl.textContent = "pr-author"
    document.body.append(authorEl)

    const reviewersSection = document.createElement("div")
    reviewersSection.className = "discussion-sidebar-heading"
    const menu = document.createElement("div")
    menu.id = "reviewers-select-menu"
    menu.append(reviewersSection)
    document.body.append(menu)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const approveBtn = reviewersSection.closest("#reviewers-select-menu")
      ?.querySelector<HTMLButtonElement>(".rgh-quick-approve")
    expect(approveBtn).toBeTruthy()

    // Alt-click bypasses confirm; still calls v3
    approveBtn!.dispatchEvent(new MouseEvent("click", { altKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))

    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining("pulls/5/reviews"),
      expect.objectContaining({ method: "POST" })
    )
    ctrl.abort()
  })

  it("does not call v3 when prompt is cancelled (confirm=false)", async () => {
    const postSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)
    vi.stubGlobal("prompt", () => null)

    vi.spyOn(window, "location", "get").mockReturnValue({
      pathname: "/o/r/pull/5",
      href: "https://github.com/o/r/pull/5",
      reload: vi.fn(),
    } as unknown as Location)

    const meta = document.createElement("meta")
    meta.setAttribute("name", "user-login")
    meta.setAttribute("content", "viewer")
    document.head.append(meta)
    const authorEl = document.createElement("a")
    authorEl.className = "author"
    authorEl.textContent = "pr-author"
    document.body.append(authorEl)

    const reviewersSection = document.createElement("div")
    reviewersSection.className = "discussion-sidebar-heading"
    const menu = document.createElement("div")
    menu.id = "reviewers-select-menu"
    menu.append(reviewersSection)
    document.body.append(menu)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const approveBtn = reviewersSection.closest("#reviewers-select-menu")
      ?.querySelector<HTMLButtonElement>(".rgh-quick-approve")
    expect(approveBtn).toBeTruthy()

    approveBtn!.dispatchEvent(new MouseEvent("click", { altKey: false, bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))

    expect(postSpy).not.toHaveBeenCalled()
    ctrl.abort()
  })
})
