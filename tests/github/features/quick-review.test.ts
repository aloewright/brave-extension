// tests/github/features/quick-review.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/quick-review"
import * as api from "../../../src/lib/github/api"

// Stub window.location.reload so v3 success path doesn't throw
function stubLocation(pathname: string) {
  Object.defineProperty(window, "location", {
    value: { pathname, href: `https://github.com${pathname}`, reload: vi.fn() },
    configurable: true,
    writable: true,
  })
}

function buildReviewerDOM() {
  const reviewersSection = document.createElement("div")
  reviewersSection.className = "discussion-sidebar-heading"
  const menu = document.createElement("div")
  menu.id = "reviewers-select-menu"
  menu.append(reviewersSection)
  document.body.append(menu)
  return reviewersSection
}

function addUserMeta(viewer: string, author: string) {
  const meta = document.createElement("meta")
  meta.setAttribute("name", "user-login")
  meta.setAttribute("content", viewer)
  document.head.append(meta)
  const authorEl = document.createElement("a")
  authorEl.className = "author"
  authorEl.textContent = author
  document.body.append(authorEl)
}

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
    const reviewersSection = buildReviewerDOM()
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(reviewersSection.querySelector(".rgh-quick-review")).toBeTruthy()
    ctrl.abort()
  })

  it("is idempotent: re-init doesn't add a second review link", async () => {
    const reviewersSection = buildReviewerDOM()
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(reviewersSection.querySelectorAll(".rgh-quick-review").length).toBe(1)
    ctrl.abort()
  })

  it("(a) confirm=false → v3 is NOT called", async () => {
    const postSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)
    // confirm gate returns false → must bail before calling v3
    vi.stubGlobal("confirm", () => false)
    vi.stubGlobal("prompt", () => null)
    stubLocation("/o/r/pull/5")
    addUserMeta("viewer", "pr-author")
    const reviewersSection = buildReviewerDOM()

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const approveBtn = document.querySelector<HTMLButtonElement>(".rgh-quick-approve")
    expect(approveBtn).toBeTruthy()

    approveBtn!.dispatchEvent(new MouseEvent("click", { altKey: false, bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))

    expect(postSpy).not.toHaveBeenCalled()
    ctrl.abort()
  })

  it("(b) confirm=true + prompt returns string → v3 POST called with event APPROVE", async () => {
    const postSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)
    vi.stubGlobal("confirm", () => true)
    vi.stubGlobal("prompt", () => "LGTM")
    vi.stubGlobal("alert", () => {})
    stubLocation("/o/r/pull/7")
    addUserMeta("viewer", "pr-author")
    buildReviewerDOM()

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const approveBtn = document.querySelector<HTMLButtonElement>(".rgh-quick-approve")
    expect(approveBtn).toBeTruthy()

    approveBtn!.dispatchEvent(new MouseEvent("click", { altKey: false, bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))

    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining("pulls/7/reviews"),
      expect.objectContaining({ method: "POST" })
    )
    // Confirm the body has event: APPROVE
    const callArgs = postSpy.mock.calls[0]
    const body = JSON.parse((callArgs[1] as RequestInit).body as string)
    expect(body.event).toBe("APPROVE")
    expect(body.body).toBe("LGTM")
    ctrl.abort()
  })

  it("(c) Alt-click → neither confirm nor prompt called, v3 IS called", async () => {
    const postSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)
    const confirmSpy = vi.fn(() => false)
    const promptSpy = vi.fn(() => null)
    vi.stubGlobal("confirm", confirmSpy)
    vi.stubGlobal("prompt", promptSpy)
    vi.stubGlobal("alert", () => {})
    stubLocation("/o/r/pull/5")
    addUserMeta("viewer", "pr-author")
    buildReviewerDOM()

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const approveBtn = document.querySelector<HTMLButtonElement>(".rgh-quick-approve")
    expect(approveBtn).toBeTruthy()

    // Alt-click bypasses both confirm and prompt
    approveBtn!.dispatchEvent(new MouseEvent("click", { altKey: true, bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(promptSpy).not.toHaveBeenCalled()
    expect(postSpy).toHaveBeenCalledWith(
      expect.stringContaining("pulls/5/reviews"),
      expect.objectContaining({ method: "POST" })
    )
    ctrl.abort()
  })

  it("prompt cancelled (null) → v3 NOT called even when confirm=true", async () => {
    const postSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)
    vi.stubGlobal("confirm", () => true)
    vi.stubGlobal("prompt", () => null)
    stubLocation("/o/r/pull/5")
    addUserMeta("viewer", "pr-author")
    buildReviewerDOM()

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const approveBtn = document.querySelector<HTMLButtonElement>(".rgh-quick-approve")
    expect(approveBtn).toBeTruthy()

    approveBtn!.dispatchEvent(new MouseEvent("click", { altKey: false, bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))

    expect(postSpy).not.toHaveBeenCalled()
    ctrl.abort()
  })
})
