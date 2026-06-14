import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("global save-link command", () => {
  it("handles the save-link command in the background by saving the active tab", () => {
    const bg = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")
    expect(bg).toContain('command === "save-link"')
    expect(bg).toContain("saveLinkToLibrary(tab.url, tab.title)")
  })
})
