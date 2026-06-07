// tests/github/features/default-branch-button.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/default-branch-button"
import * as api from "../../../src/lib/github/api"
import * as repo from "../../../src/lib/github/repo"
import { isRepo } from "../../../src/lib/github/page-detect"

beforeEach(() => {
  document.head.innerHTML = ""
  document.body.innerHTML = ""
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("default-branch-button metadata", () => {
  it("has correct id, category, defaultEnabled, needsToken", () => {
    expect(feature.id).toBe("default-branch-button")
    expect(feature.category).toBe("repository")
    expect(feature.defaultEnabled).toBe(true)
    expect(feature.needsToken).toBe(true)
  })
  it("pageTest returns true on repo pages", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/tree/my-branch"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/settings"))).toBe(false)
  })
})

describe("default-branch-button behavior", () => {
  it("no-op when hasToken returns false", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(false)
    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    expect(document.querySelector(".rgh-default-branch-button")).toBeNull()
    ctrl.abort()
  })

  it("injects button and style when on non-default branch", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.spyOn(api, "v3").mockResolvedValue({ default_branch: "main" })
    vi.spyOn(repo, "parseRepo").mockReturnValue({
      owner: "o", name: "r", nameWithOwner: "o/r", branch: "my-feature"
    })

    // Simulate a branch selector element
    const summary = Object.assign(document.createElement("summary"), {
      textContent: "my-feature"
    })
    summary.setAttribute("data-hotkey", "w")
    const details = document.createElement("details")
    details.append(summary)
    document.body.append(details)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(document.querySelector(".rgh-default-branch-button")).not.toBeNull()
    expect(document.querySelector(`style[data-rgh="default-branch-button"]`)).not.toBeNull()
    ctrl.abort()
  })

  it("does not inject button when already on default branch", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.spyOn(api, "v3").mockResolvedValue({ default_branch: "main" })
    vi.spyOn(repo, "parseRepo").mockReturnValue({
      owner: "o", name: "r", nameWithOwner: "o/r", branch: "main"
    })

    const summary = Object.assign(document.createElement("summary"), {
      textContent: "main"
    })
    summary.setAttribute("data-hotkey", "w")
    const details = document.createElement("details")
    details.append(summary)
    document.body.append(details)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(document.querySelector(".rgh-default-branch-button")).toBeNull()
    ctrl.abort()
  })

  it("is idempotent — does not add multiple buttons on re-init", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.spyOn(api, "v3").mockResolvedValue({ default_branch: "main" })
    vi.spyOn(repo, "parseRepo").mockReturnValue({
      owner: "o", name: "r", nameWithOwner: "o/r", branch: "feature"
    })

    const summary = Object.assign(document.createElement("summary"), {
      textContent: "feature"
    })
    summary.setAttribute("data-hotkey", "w")
    const details = document.createElement("details")
    details.append(summary)
    document.body.append(details)

    const ctrl1 = new AbortController()
    await feature.init(ctrl1.signal)
    await new Promise((r) => setTimeout(r, 20))
    ctrl1.abort()

    const ctrl2 = new AbortController()
    await feature.init(ctrl2.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(document.querySelectorAll(".rgh-default-branch-button").length).toBe(1)
    ctrl2.abort()
  })
})
