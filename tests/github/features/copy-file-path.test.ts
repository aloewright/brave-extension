// tests/github/features/copy-file-path.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import feature from "../../../src/lib/github/features/copy-file-path"
import * as repo from "../../../src/lib/github/repo"

beforeEach(() => { document.body.innerHTML = "" })

describe("copy-file-path", () => {
  it("adds a copy button next to a file actions container", async () => {
    vi.spyOn(repo, "parseRepo").mockReturnValue({
      owner: "o", name: "r", nameWithOwner: "o/r", branch: "main", filePath: "src/a.ts"
    })
    document.body.append(
      Object.assign(document.createElement("div"), { className: "file-actions" })
    )
    const ctrl = new AbortController()
    feature.init(ctrl.signal)
    await new Promise((r) => setTimeout(r, 10))
    const btn = document.querySelector<HTMLButtonElement>(".rgh-copy-file-path")
    expect(btn).not.toBeNull()
    const writeText = vi.fn()
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true })
    btn!.click()
    expect(writeText).toHaveBeenCalledWith("src/a.ts")
    ctrl.abort()
  })
})
