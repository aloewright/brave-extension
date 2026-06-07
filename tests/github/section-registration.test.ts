import { describe, it, expect } from "vitest"
import { SECTIONS } from "../../src/sections/types"

describe("github section registration", () => {
  it("includes a github section", () => {
    expect(SECTIONS.some((s) => s.id === "github")).toBe(true)
  })
})
