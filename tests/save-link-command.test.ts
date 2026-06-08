import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("global save-link command", () => {
  it("registers the save-link command with Shift+Cmd/Ctrl+L in the manifest", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      manifest?: { commands?: Record<string, { suggested_key?: Record<string, string> }> }
    }
    const cmd = pkg.manifest?.commands?.["save-link"]
    expect(cmd).toBeTruthy()
    expect(cmd?.suggested_key?.default).toBe("Ctrl+Shift+L")
    expect(cmd?.suggested_key?.mac).toBe("Command+Shift+L")
  })

  it("handles the save-link command in the background by saving the active tab", () => {
    const bg = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")
    expect(bg).toContain('command === "save-link"')
    expect(bg).toContain("saveLinkToLibrary(tab.url, tab.title)")
  })
})
