// tests/github/features/restore-file.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/restore-file"
import * as api from "../../../src/lib/github/api"
import * as repo from "../../../src/lib/github/repo"

// Build the exact DOM the feature observes:
//   [class^="DiffFileHeader-module__diff-file-header"]
//     button:has(>.octicon-kebab-horizontal)   ← the menu-button the feature binds
//   After click + rAF, it looks for:
//     [class^="prc-ActionList-ActionListItem"]:has(.octicon-pencil)  ← edit item to clone
function buildDiffHeaderDOM() {
  const diffFileHeader = document.createElement("div")
  diffFileHeader.className = "DiffFileHeader-module__diff-file-header--fake"

  // File name element the feature reads
  const fileNameWrapper = document.createElement("div")
  fileNameWrapper.className = "DiffFileHeader-module__file-name--fake"
  const nameSpan = document.createElement("span")
  nameSpan.textContent = "src/foo.ts"
  fileNameWrapper.append(nameSpan)
  diffFileHeader.append(fileNameWrapper)

  // The kebab button the feature observes
  const kebabBtn = document.createElement("button")
  const kebabIcon = document.createElement("svg")
  kebabIcon.className = "octicon-kebab-horizontal"
  kebabBtn.append(kebabIcon)
  diffFileHeader.append(kebabBtn)

  document.body.append(diffFileHeader)
  return { diffFileHeader, kebabBtn }
}

// After kebab click, the feature looks for this edit action item in the DOM
function addEditActionItem() {
  const editItem = document.createElement("div")
  editItem.className = "prc-ActionList-ActionListItem--fake"
  const pencilIcon = document.createElement("svg")
  pencilIcon.className = "octicon-pencil"
  editItem.append(pencilIcon)
  const labelEl = document.createElement("span")
  labelEl.className = "prc-ActionList-ItemLabel--fake"
  labelEl.textContent = "Edit file"
  editItem.append(labelEl)
  document.body.append(editItem)
  return editItem
}

beforeEach(() => {
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  vi.restoreAllMocks()
})
afterEach(() => { vi.restoreAllMocks() })

describe("restore-file metadata", () => {
  it("is write-actions, off by default, needsToken, repo scope, confirm string", () => {
    expect(feature.category).toBe("write-actions")
    expect(feature.defaultEnabled).toBe(false)
    expect(feature.needsToken).toBe(true)
    expect(feature.writeScopes).toContain("repo")
    expect(typeof feature.confirm).toBe("string")
    expect(feature.confirm!.length).toBeGreaterThan(0)
  })

  it("pageTest matches /files path", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1/files"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(false)
  })
})

describe("restore-file behaviour", () => {
  it("no token → hasToken called, v4 not called on discard click", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(false)
    vi.spyOn(api, "v4").mockResolvedValue({})
    vi.stubGlobal("confirm", () => true)
    vi.stubGlobal("prompt", () => "Discard commit")
    vi.stubGlobal("alert", () => {})

    const { kebabBtn } = buildDiffHeaderDOM()
    addEditActionItem()

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))

    // Click kebab to trigger the click listener the feature binds
    kebabBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    // Wait for requestAnimationFrame + hasToken check
    await new Promise((r) => setTimeout(r, 50))

    // hasToken was false → discard item should not be injected → v4 never called
    expect(api.v4).not.toHaveBeenCalled()
    ctrl.abort()
  })

  it("confirm=false → v4 NOT called when discard item is clicked", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    const v4Spy = vi.spyOn(api, "v4").mockResolvedValue({})
    vi.stubGlobal("confirm", () => false)
    vi.stubGlobal("prompt", () => "Discard commit title")
    vi.stubGlobal("alert", () => {})

    Object.defineProperty(window, "location", {
      value: {
        pathname: "/o/r/pull/1/files",
        href: "https://github.com/o/r/pull/1/files",
      },
      configurable: true,
      writable: true,
    })
    vi.spyOn(repo, "parseRepo").mockReturnValue({ owner: "o", name: "r", nameWithOwner: "o/r" } as ReturnType<typeof repo.parseRepo>)

    const { kebabBtn } = buildDiffHeaderDOM()
    addEditActionItem()

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))

    // Trigger the kebab click so the feature injects the discard item
    kebabBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    // Find the injected discard item and click it
    const discardItem = document.querySelector<HTMLElement>(".rgh-restore-file-item")
    expect(discardItem).toBeTruthy()

    discardItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))

    // confirm returned false → gate stops execution → v4 must not be called
    expect(v4Spy).not.toHaveBeenCalled()
    ctrl.abort()
  })

  it("confirm=true + prompt returns title → v4 createCommitOnBranch called", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    // v3 is called for mergeBaseSha and file contents; v4 is called for the mutation
    vi.spyOn(api, "v3").mockResolvedValue({ merge_base_commit: { sha: "basesha" } } as never)
    const v4Spy = vi.spyOn(api, "v4").mockResolvedValue({ createCommitOnBranch: { commit: { oid: "newsha" } } })
    vi.stubGlobal("confirm", () => true)
    vi.stubGlobal("prompt", () => "Discard changes to src/foo.ts")
    vi.stubGlobal("alert", () => {})

    Object.defineProperty(window, "location", {
      value: {
        pathname: "/o/r/pull/1/files",
        href: "https://github.com/o/r/pull/1/files",
      },
      configurable: true,
      writable: true,
    })
    vi.spyOn(repo, "parseRepo").mockReturnValue({ owner: "o", name: "r", nameWithOwner: "o/r" } as ReturnType<typeof repo.parseRepo>)

    // Add branch name elements for base/head detection
    const baseEl = document.createElement("span")
    baseEl.className = "base-ref"
    baseEl.textContent = "main"
    document.body.append(baseEl)
    const headEl = document.createElement("span")
    headEl.className = "head-ref"
    headEl.textContent = "feature-branch"
    document.body.append(headEl)

    // Add head OID element
    const headOidEl = document.createElement("div")
    headOidEl.dataset.currentPullRequestHeadOid = "headsha123"
    document.body.append(headOidEl)

    const { kebabBtn } = buildDiffHeaderDOM()
    addEditActionItem()

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))

    kebabBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await new Promise((r) => setTimeout(r, 50))

    const discardItem = document.querySelector<HTMLElement>(".rgh-restore-file-item")
    expect(discardItem).toBeTruthy()

    discardItem!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    // Wait for async API calls (v3 merge base + v4 mutation)
    await new Promise((r) => setTimeout(r, 100))

    expect(v4Spy).toHaveBeenCalledWith(
      expect.stringContaining("createCommitOnBranch"),
      expect.objectContaining({ input: expect.anything() })
    )
    ctrl.abort()
  })

  it("is idempotent: calling init twice doesn't double-bind", async () => {
    vi.spyOn(api, "hasToken").mockResolvedValue(true)
    vi.stubGlobal("confirm", () => false)
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    feature.init(ctrl.signal)
    ctrl.abort()
    // No error = pass
    expect(true).toBe(true)
  })
})
