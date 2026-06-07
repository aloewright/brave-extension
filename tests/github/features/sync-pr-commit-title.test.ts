// tests/github/features/sync-pr-commit-title.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import feature from "../../../src/lib/github/features/sync-pr-commit-title"

// Build a fixture DOM that matches the REAL selectors used by sync-pr-commit-title:
//   PR title:    h1[class^="prc-PageHeader-Title"] .markdown-title
//   Commit field: [data-testid="mergebox-partial"] input[type="text"]
//   Squash btn:   [data-testid="merge-box"] button  (text includes "squash")
function buildPrPage(prTitle: string, commitTitle: string) {
  // PR title h1 — class must start with "prc-PageHeader-Title"
  const titleH1 = document.createElement("h1")
  titleH1.className = "prc-PageHeader-Title"
  const titleSpan = document.createElement("span")
  titleSpan.className = "markdown-title"
  titleSpan.textContent = prTitle
  titleH1.append(titleSpan)
  document.body.append(titleH1)

  // Merge box wrapper — data-testid="mergebox-partial" contains the commit field
  const mergeBoxPartial = document.createElement("div")
  mergeBoxPartial.dataset.testid = "mergebox-partial"
  const commitField = document.createElement("input")
  commitField.type = "text"
  commitField.value = commitTitle
  mergeBoxPartial.append(commitField)
  document.body.append(mergeBoxPartial)

  // Squash merge button — [data-testid="merge-box"] button with "squash" text
  const mergeBox = document.createElement("div")
  mergeBox.dataset.testid = "merge-box"
  const squashBtn = document.createElement("button")
  squashBtn.textContent = "Squash and merge"
  mergeBox.append(squashBtn)
  document.body.append(mergeBox)

  return { titleH1, titleSpan, commitField, squashBtn }
}

beforeEach(() => {
  document.body.innerHTML = ""
  document.head.innerHTML = ""
  vi.restoreAllMocks()
})
afterEach(() => { vi.restoreAllMocks() })

describe("sync-pr-commit-title metadata", () => {
  it("is write-actions, off by default, needsToken false", () => {
    expect(feature.category).toBe("write-actions")
    expect(feature.defaultEnabled).toBe(false)
    expect(feature.needsToken).toBe(false)
  })

  it("pageTest matches PR conversation page", () => {
    expect(feature.pageTest(new URL("https://github.com/o/r/pull/1"))).toBe(true)
    expect(feature.pageTest(new URL("https://github.com/o/r/issues/1"))).toBe(false)
  })
})

describe("sync-pr-commit-title behaviour", () => {
  it("syncs commit title to 'PR title (#N)' format when merge box is present", async () => {
    vi.spyOn(window, "location", "get").mockReturnValue({
      pathname: "/o/r/pull/42",
      href: "https://github.com/o/r/pull/42",
    } as unknown as Location)

    // Commit field starts with stale value; feature should update it to 'My feature (#42)'
    const { commitField } = buildPrPage("My feature", "Old stale title (#42)")

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    // The feature syncs the input to "PR title (#number)"
    expect(commitField.value).toBe("My feature (#42)")
    ctrl.abort()
  })

  it("does not overwrite commit title when it already matches the target format", async () => {
    vi.spyOn(window, "location", "get").mockReturnValue({
      pathname: "/o/r/pull/10",
      href: "https://github.com/o/r/pull/10",
    } as unknown as Location)

    const { commitField } = buildPrPage("Correct title", "Correct title (#10)")

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 20))

    // Already correct — field should remain unchanged
    expect(commitField.value).toBe("Correct title (#10)")
    ctrl.abort()
  })

  it("observe fires PR_TITLE_SELECTOR and re-syncs commit field when title element appears later", async () => {
    vi.spyOn(window, "location", "get").mockReturnValue({
      pathname: "/o/r/pull/99",
      href: "https://github.com/o/r/pull/99",
    } as unknown as Location)

    // Only put the commit field in the DOM first, no PR title yet
    const mergeBoxPartial = document.createElement("div")
    mergeBoxPartial.dataset.testid = "mergebox-partial"
    const commitField = document.createElement("input")
    commitField.type = "text"
    commitField.value = "Some old title"
    mergeBoxPartial.append(commitField)
    document.body.append(mergeBoxPartial)

    const mergeBox = document.createElement("div")
    mergeBox.dataset.testid = "merge-box"
    const squashBtn = document.createElement("button")
    squashBtn.textContent = "Squash and merge"
    mergeBox.append(squashBtn)
    document.body.append(mergeBox)

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))

    // Now inject a PR title element — the observe callback fires and calls syncCommitTitle
    const titleH1 = document.createElement("h1")
    titleH1.className = "prc-PageHeader-Title"
    const titleSpan = document.createElement("span")
    titleSpan.className = "markdown-title"
    titleSpan.textContent = "New PR title"
    titleH1.append(titleSpan)
    document.body.append(titleH1)

    await new Promise((r) => setTimeout(r, 20))

    // After the PR title element is observed, the feature should sync the commit field
    // to "New PR title (#99)"
    expect(commitField.value).toBe("New PR title (#99)")
    ctrl.abort()
  })

  it("is idempotent: calling init twice doesn't throw", async () => {
    vi.spyOn(window, "location", "get").mockReturnValue({
      pathname: "/o/r/pull/1",
      href: "https://github.com/o/r/pull/1",
    } as unknown as Location)

    buildPrPage("Title", "Title (#1)")

    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))
    ctrl.abort()
    // No error = pass
    expect(true).toBe(true)
  })
})
