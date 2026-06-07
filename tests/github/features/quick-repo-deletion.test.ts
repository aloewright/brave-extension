// tests/github/features/quick-repo-deletion.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import feature from "../../../src/lib/github/features/quick-repo-deletion"
import * as repo from "../../../src/lib/github/repo"

beforeEach(() => { document.body.innerHTML = "" })

describe("quick-repo-deletion", () => {
  it("is a write feature, off by default, with a confirm prompt", () => {
    expect(feature.isWrite).toBe(true)
    expect(feature.defaultEnabled).toBe(false)
    expect(typeof feature.confirm).toBe("string")
    expect(feature.category).toBe("write-actions")
  })
  it("auto-fills the danger-zone confirmation field when present", async () => {
    vi.spyOn(repo, "parseRepo").mockReturnValue({ owner: "o", name: "r", nameWithOwner: "o/r" })
    const input = Object.assign(document.createElement("input"), {
      className: "js-repo-delete-proceed-confirmation"
    })
    document.body.append(input)
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))
    // The feature pre-fills the owner/name when the field appears.
    expect(input.value.length).toBeGreaterThan(0)
    ctrl.abort()
  })
})
