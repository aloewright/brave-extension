import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("Page Captures section UI", () => {
  it("renders screenshot blob previews in the capture list", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/captures/CapturesSection.tsx"),
      "utf8"
    )

    expect(source).toContain("function CapturePreview")
    expect(source).toContain("fetchCaptureBlob(config, item.blobUrl)")
    expect(source).toContain("<img")
    expect(source).toContain('alt={`${item.filename} preview`}')
    expect(source).toContain("URL.revokeObjectURL")
  })

  it("uses a regular camera icon for the Page Captures rail item", () => {
    const rail = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8"
    )
    const icons = readFileSync(
      join(process.cwd(), "src/components/leo.tsx"),
      "utf8"
    )

    expect(rail).toContain('captures: "camera"')
    expect(icons).toContain('| "camera"')
    expect(icons).toContain("camera: (")
  })
})
