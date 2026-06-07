// tests/github/features/quick-label-removal.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/quick-label-removal"
import * as api from "../../../src/lib/github/api"
import * as repo from "../../../src/lib/github/repo"

beforeEach(() => {
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})
afterEach(() => { vi.restoreAllMocks() })

describe("quick-label-removal metadata", () => {
  it("is write-actions, off by default, needsToken, repo scope", () => {
    expect(feature.category).toBe("write-actions")
    expect(feature.defaultEnabled).toBe(false)
    expect(feature.needsToken).toBe(true)
    expect(feature.writeScopes).toContain("repo")
  })

  it("no confirm string (direct action with label name)", () => {
    // RGH removes without confirm; the button itself is the confirmation UX
    expect(feature.confirm).toBeUndefined()
  })

  it("pageTest matches issues and PRs", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/issues/1"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r"))).toBe(false)
  })
})

describe("quick-label-removal behaviour", () => {
  it("returns early when no token", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(false)
    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    ctrl.abort()
    expect(api.hasToken).toHaveBeenCalled()
    // No removal buttons injected
    expect(document.querySelectorAll(".rgh-quick-label-removal").length).toBe(0)
  })

  it("injects remove button on label element when token present", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    const ctrl = new AbortController()
    const label = document.createElement("a")
    label.className = "IssueLabel"
    label.dataset.name = "bug"
    const labelList = document.createElement("div")
    labelList.className = "js-issue-labels"
    labelList.append(label)
    document.body.append(labelList)

    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(label.querySelector(".rgh-quick-label-removal")).toBeTruthy()
    ctrl.abort()
  })

  it("calls v3 DELETE when remove button is clicked", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.spyOn(repo, "parseRepo").mockReturnValue({ owner: "o", name: "r", nameWithOwner: "o/r" })
    const deleteSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)

    // Set URL so getConversationNumber works
    Object.defineProperty(window, "location", {
      value: { pathname: "/o/r/issues/42", href: "https://github.com/o/r/issues/42" },
      writable: true,
    })

    const label = document.createElement("a")
    label.className = "IssueLabel"
    label.dataset.name = "bug"
    const labelList = document.createElement("div")
    labelList.className = "js-issue-labels"
    labelList.append(label)
    document.body.append(labelList)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const btn = label.querySelector<HTMLButtonElement>(".rgh-quick-label-removal")
    expect(btn).toBeTruthy()
    btn!.click()
    await new Promise((r) => setTimeout(r, 20))

    expect(deleteSpy).toHaveBeenCalledWith(
      expect.stringContaining("bug"),
      expect.objectContaining({ method: "DELETE" })
    )
    ctrl.abort()
  })

  it("is idempotent: re-init doesn't add a second button", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    const label = document.createElement("a")
    label.className = "IssueLabel"
    label.dataset.name = "bug"
    const labelList = document.createElement("div")
    labelList.className = "js-issue-labels"
    labelList.append(label)
    document.body.append(labelList)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(label.querySelectorAll(".rgh-quick-label-removal").length).toBe(1)
    ctrl.abort()
  })
})
