import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("resizable sidebar window", () => {
  it("opens sidepanel.html in a normal resizable popup window", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/sidebar-window.ts"),
      "utf8"
    )

    expect(source).toContain('chrome.runtime.getURL("sidepanel.html?window=1")')
    expect(source).toContain('type: "popup"')
    expect(source).toContain("width: DEFAULT_SIDEBAR_WINDOW_WIDTH")
    expect(source).toContain("height: DEFAULT_SIDEBAR_WINDOW_HEIGHT")
    expect(source).toContain("focused: true")
  })
})
