import { describe, it, expect } from "vitest"
import { normalizeTags } from "../src/lib/sidebar-api"

describe("normalizeTags", () => {
  it("passes arrays through (string-only)", () => {
    expect(normalizeTags(["a", "b"])).toEqual(["a", "b"])
    expect(normalizeTags(["a", 1, null, "b"] as unknown)).toEqual(["a", "b"])
  })
  it("parses a JSON-array string (the D1 TEXT shape)", () => {
    expect(normalizeTags('["x","y"]')).toEqual(["x", "y"])
  })
  it("returns [] for non-array / non-JSON / empty / undefined", () => {
    expect(normalizeTags(undefined)).toEqual([])
    expect(normalizeTags("")).toEqual([])
    expect(normalizeTags("plain")).toEqual([])
    expect(normalizeTags(42 as unknown)).toEqual([])
  })
})
