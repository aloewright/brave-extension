// tests/github/features/new-repo-disable-projects-and-wikis.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/new-repo-disable-projects-and-wikis"
import * as api from "../../../src/lib/github/api"

beforeEach(() => {
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  vi.restoreAllMocks()
  sessionStorage.clear()
})
afterEach(() => {
  vi.restoreAllMocks()
  sessionStorage.clear()
})

describe("new-repo-disable-projects-and-wikis metadata", () => {
  it("is write-actions, off by default, needsToken, repo scope", () => {
    expect(feature.category).toBe("write-actions")
    expect(feature.defaultEnabled).toBe(false)
    expect(feature.needsToken).toBe(true)
    expect(feature.writeScopes).toContain("repo")
  })

  it("pageTest matches /new", () => {
    expect(feature.pageTest(new URL("https://github.com/new"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r"))).toBe(false)
  })
})

describe("new-repo-disable-projects-and-wikis behaviour", () => {
  it("returns early when no token", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(false)
    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    ctrl.abort()
    expect(api.hasToken).toHaveBeenCalled()
    expect(document.querySelector("#rgh-disable-projects-wikis")).toBeNull()
  })

  it("injects checkbox next to submit button when token present", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)

    const form = document.createElement("form")
    // Simulate the octicon-info class present on new-repo form
    const iconEl = document.createElement("span")
    iconEl.className = "octicon-info"
    form.append(iconEl)
    const btn = document.createElement("button")
    btn.type = "submit"
    btn.className = "btn-primary"
    form.append(btn)
    document.body.append(form)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    expect(document.querySelector("#rgh-disable-projects-wikis")).toBeTruthy()
    ctrl.abort()
  })

  it("calls v3 PATCH after creation when session flag is set", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    const patchSpy = vi.spyOn(api, "v3").mockResolvedValue(undefined)
    sessionStorage.setItem("rghNewRepo", "1")

    vi.spyOn(window, "location", "get").mockReturnValue({
      pathname: "/owner/newrepo",
      href: "https://github.com/owner/newrepo",
    } as unknown as Location)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    ctrl.abort()

    expect(patchSpy).toHaveBeenCalledWith(
      "/repos/owner/newrepo",
      expect.objectContaining({ method: "PATCH" })
    )
    expect(sessionStorage.getItem("rghNewRepo")).toBeNull()
  })
})
