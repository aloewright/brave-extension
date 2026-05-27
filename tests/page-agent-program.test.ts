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

  it("wraps a legacy single action into a 1-op program", () => {
    const plan = { action: { kind: "click", ref: "el5", reason: "open form" } }
    expect(parseProgram(plan)).toEqual([{ kind: "browser.click", ref: "el5" }])
  })

  it("legacy action `type` maps with value", () => {
    const plan = { action: { kind: "type", ref: "el7", value: "alice" } }
    expect(parseProgram(plan)).toEqual([{ kind: "browser.type", ref: "el7", value: "alice" }])
  })

  it("legacy action with unknown kind yields []", () => {
    const plan = { action: { kind: "telepathy", ref: "el5" } }
    expect(parseProgram(plan)).toEqual([])
  })

  it("when both program and action are present, program wins", () => {
    const plan = {
      action: { kind: "click", ref: "el1" },
      program: [{ op: "browser.observe" }]
    }
    expect(parseProgram(plan)).toEqual([{ kind: "browser.observe" }])
  })
})
