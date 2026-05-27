import { describe, expect, it } from "vitest"
import { parseProgram, MAX_OPS, executeProgram, type Op, type ProgramDeps } from "../src/background/page-agent-program"

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

  it("clamps to MAX_OPS = 8", () => {
    const program = Array.from({ length: 20 }, () => ({ op: "browser.observe" }))
    const plan = { program }
    expect(parseProgram(plan)).toHaveLength(MAX_OPS)
  })

  it("drops ops with unknown kinds and keeps known ones", () => {
    const plan = {
      program: [
        { op: "browser.observe" },
        { op: "telepathy" },
        { op: "browser.click", ref: "el1" }
      ]
    }
    expect(parseProgram(plan)).toEqual([
      { kind: "browser.observe" },
      { kind: "browser.click", ref: "el1" }
    ])
  })
})

const initialObs = {
  nodes: [
    { ref: "el12", name: "Sign in", selector: "button.sign-in" },
    { ref: "el18", name: "Email", selector: "input#email" }
  ]
}

function makeDeps(overrides: Partial<ProgramDeps> = {}): ProgramDeps {
  const calls: any[] = []
  const deps: ProgramDeps = {
    runTool: async (name, args) => {
      calls.push({ tool: "runTool", name, args })
      return { ok: true, data: null }
    },
    observe: async () => {
      calls.push({ tool: "observe" })
      return initialObs
    },
    wait: async (ms) => {
      calls.push({ tool: "wait", ms })
    },
    now: (() => {
      let t = 1000
      return () => (t += 100)
    })(),
    ...overrides
  }
  ;(deps as any)._calls = calls
  return deps
}

describe("executeProgram", () => {
  it("runs ops linearly and produces a step entry per op", async () => {
    const program: Op[] = [
      { kind: "browser.click", ref: "el12" },
      { kind: "browser.type", ref: "el18", value: "alice" },
      { kind: "browser.observe" }
    ]
    const deps = makeDeps()
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps).toHaveLength(3)
    expect(result.steps.map((s) => s.kind)).toEqual([
      "browser.click",
      "browser.type",
      "browser.observe"
    ])
    expect(result.steps.every((s) => s.ok)).toBe(true)
    expect(result.steps[0].label).toBe("Sign in")
    expect(result.steps[1].label).toBe("Email")
  })
})
