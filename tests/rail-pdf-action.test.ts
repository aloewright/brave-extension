import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("rail full-page PDF action", () => {
  it("registers a Save full-page PDF quick action", () => {
    const src = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")
    expect(src).toContain("runFullPagePdfQuickAction")
    expect(src).toContain("Save full-page PDF")
  })
})
