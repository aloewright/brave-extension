// tests/github/features/update-pr-from-base-branch.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/update-pr-from-base-branch"
import * as api from "../../../src/lib/github/api"

// Build the exact DOM structure the feature observes:
//   section[aria-label='Conflicts']
//     .flex-shrink-0
//       :first-child   ← the stateIcon element observed
//     div[class^='MergeBoxSectionHeader-module__contentLayout']   ← where buttons are injected
function buildConflictsDOM(withCheckIcon: boolean) {
  const section = document.createElement("section")
  section.setAttribute("aria-label", "Conflicts")

  const headerLayout = document.createElement("div")
  // class must start with 'MergeBoxSectionHeader-module__contentLayout'
  headerLayout.className = "MergeBoxSectionHeader-module__contentLayout--x"
  section.append(headerLayout)

  const flexShrink = document.createElement("div")
  flexShrink.className = "flex-shrink-0"
  section.append(flexShrink)

  const stateIcon = document.createElement("div")
  if (withCheckIcon) {
    // Use a span rather than svg to avoid SVG className quirks in happy-dom
    const icon = document.createElement("span")
    icon.className = "octicon-check"
    stateIcon.append(icon)
  }
  flexShrink.append(stateIcon)
  document.body.append(section)

  return { section, headerLayout, stateIcon }
}

function addPrIdAttrs(nodeId = "PR_abc123", headOid = "sha123") {
  const prEl = document.createElement("div")
  prEl.dataset.pullNodeId = nodeId
  document.body.append(prEl)

  const headEl = document.createElement("div")
  headEl.dataset.currentPullRequestHeadOid = headOid
  document.body.append(headEl)
}

beforeEach(() => {
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  vi.restoreAllMocks()
})
afterEach(() => { vi.restoreAllMocks() })

describe("update-pr-from-base-branch metadata", () => {
  it("is write-actions, off by default, needsToken, repo scope, confirm string", () => {
    expect(feature.category).toBe("write-actions")
    expect(feature.defaultEnabled).toBe(false)
    expect(feature.needsToken).toBe(true)
    expect(feature.writeScopes).toContain("repo")
    expect(typeof feature.confirm).toBe("string")
    expect(feature.confirm!.length).toBeGreaterThan(0)
  })

  it("pageTest matches PR pages", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/issues/1"))).toBe(false)
  })
})

describe("update-pr-from-base-branch behaviour", () => {
  it("returns early when no token", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(false)
    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    ctrl.abort()
    expect(api.hasToken).toHaveBeenCalled()
    expect(document.querySelector(".rgh-update-pr-group")).toBeNull()
  })

  it("injects button group when state icon has octicon-check", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.stubGlobal("confirm", () => false)
    addPrIdAttrs()
    buildConflictsDOM(true)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    // The feature injects into div[class^='MergeBoxSectionHeader-module__contentLayout']
    // Assert BEFORE aborting: abort removes injected groups via cleanup handler.
    expect(document.querySelector(".rgh-update-pr-group")).toBeTruthy()
    expect(document.querySelectorAll(".rgh-update-pr-btn").length).toBe(2) // MERGE + REBASE
    ctrl.abort()
  })

  it("confirm=false → v4 NOT called when injected button is clicked", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.stubGlobal("confirm", () => false)
    vi.stubGlobal("alert", () => {})
    const mutationSpy = vi.spyOn(api, "v4").mockResolvedValue({})
    addPrIdAttrs()
    buildConflictsDOM(true)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const mergeBtn = document.querySelector<HTMLButtonElement>('[data-method="MERGE"].rgh-update-pr-btn')
    expect(mergeBtn).toBeTruthy()

    mergeBtn!.click()
    await new Promise((r) => setTimeout(r, 20))

    // confirm returned false → mutation must not fire
    expect(mutationSpy).not.toHaveBeenCalled()
    ctrl.abort()
  })

  it("confirm=true → v4 mutation called when injected button is clicked", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.stubGlobal("confirm", () => true)
    vi.stubGlobal("alert", () => {})
    const mutationSpy = vi.spyOn(api, "v4").mockResolvedValue({})
    Object.defineProperty(window, "location", {
      value: { pathname: "/o/r/pull/1", href: "https://github.com/o/r/pull/1", reload: vi.fn() },
      configurable: true,
      writable: true,
    })
    addPrIdAttrs("PR_node_id", "headsha")
    buildConflictsDOM(true)

    const ctrl = new AbortController()
    await feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    const mergeBtn = document.querySelector<HTMLButtonElement>('[data-method="MERGE"].rgh-update-pr-btn')
    expect(mergeBtn).toBeTruthy()

    mergeBtn!.click()
    await new Promise((r) => setTimeout(r, 40))

    expect(mutationSpy).toHaveBeenCalledWith(
      expect.stringContaining("updatePullRequestBranch"),
      expect.objectContaining({
        input: expect.objectContaining({
          pullRequestId: "PR_node_id",
          updateMethod: "MERGE",
        }),
      })
    )
    ctrl.abort()
  })
})
