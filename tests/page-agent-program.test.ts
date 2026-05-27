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

  it("halts on first non-skipped failure and marks remaining ops 'halted after error'", async () => {
    const program: Op[] = [
      { kind: "browser.click", ref: "el12" },
      { kind: "browser.type", ref: "el18", value: "alice" },
      { kind: "browser.observe" }
    ]
    let calls = 0
    const deps = makeDeps({
      runTool: async (name) => {
        calls += 1
        if (calls === 1) return { ok: false, reason: "click intercepted" }
        return { ok: true }
      }
    })
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0].ok).toBe(false)
    expect(result.steps[0].reason).toBe("click intercepted")
    expect(result.steps[1].ok).toBe(false)
    expect(result.steps[1].skipped).toBe(true)
    expect(result.steps[1].reason).toBe("halted after error")
    expect(result.steps[2].ok).toBe(false)
    expect(result.steps[2].skipped).toBe(true)
    expect(result.steps[2].reason).toBe("halted after error")
  })

  it("skips click when ref is not in observation but continues running", async () => {
    const program: Op[] = [
      { kind: "browser.click", ref: "ghost" },
      { kind: "browser.observe" }
    ]
    const deps = makeDeps()
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps[0].ok).toBe(false)
    expect(result.steps[0].skipped).toBe(true)
    expect(result.steps[0].reason).toBe("ref not in observation")
    expect(result.steps[1].ok).toBe(true)
  })

  it("clamps browser.wait to 2000ms and records reason", async () => {
    const program: Op[] = [{ kind: "browser.wait", ms: 999_999 }]
    let waitedMs = -1
    const deps = makeDeps({ wait: async (ms) => { waitedMs = ms } })
    const result = await executeProgram(1, program, initialObs, deps)
    expect(waitedMs).toBe(2000)
    expect(result.steps[0].ok).toBe(true)
    expect(result.steps[0].reason).toBe("clamped to 2000ms")
  })

  it("browser.wait under cap is unmodified", async () => {
    const program: Op[] = [{ kind: "browser.wait", ms: 500 }]
    const deps = makeDeps()
    const result = await executeProgram(1, program, initialObs, deps)
    expect(result.steps[0].ok).toBe(true)
    expect(result.steps[0].reason).toBeUndefined()
  })
})
