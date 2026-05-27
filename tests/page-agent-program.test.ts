import { describe, expect, it } from "vitest"
import { parseProgram, MAX_OPS } from "../src/background/page-agent-program"

describe("parseProgram", () => {
  it("accepts a modern program field with valid ops", () => {
    const plan = {
      program: [
        { op: "browser.observe" },
        { op: "browser.click", ref: "el12" },
        { op: "browser.type", ref: "el18", value: "alice@example.com" }
      ]
    }
    expect(parseProgram(plan)).toEqual([
      { kind: "browser.observe" },
      { kind: "browser.click", ref: "el12" },
      { kind: "browser.type", ref: "el18", value: "alice@example.com" }
    ])
  })

  it("returns [] when plan is null/undefined/empty", () => {
    expect(parseProgram(null)).toEqual([])
    expect(parseProgram(undefined)).toEqual([])
    expect(parseProgram({})).toEqual([])
    expect(parseProgram({ program: [] })).toEqual([])
  })

  it("exposes MAX_OPS = 8", () => {
    expect(MAX_OPS).toBe(8)
  })
})
