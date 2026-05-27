import { describe, expect, it } from "vitest"
import { summarizeStep, type Op, type OpResult } from "../src/background/page-agent-program"

const obs = {
  nodes: [
    { ref: "el12", name: "Sign in", text: "Sign in", selector: "button.sign-in" },
    { ref: "el18", name: "Email", text: "", selector: "input#email" }
  ]
}

describe("summarizeStep", () => {
  it("labels click with observation node name", () => {
    const op: Op = { kind: "browser.click", ref: "el12" }
    const r: OpResult = { ok: true, durationMs: 120, selector: "button.sign-in" }
    const step = summarizeStep(op, r, obs)
    expect(step.kind).toBe("browser.click")
    expect(step.label).toBe("Sign in")
    expect(step.ok).toBe(true)
    expect(step.selector).toBe("button.sign-in")
    expect(step.durationMs).toBe(120)
  })

  it("labels type with node name and truncates value preview", () => {
    const op: Op = {
      kind: "browser.type",
      ref: "el18",
      value: "alice@example.com"
    }
    const r: OpResult = { ok: true, durationMs: 80 }
    const step = summarizeStep(op, r, obs)
    expect(step.kind).toBe("browser.type")
    expect(step.label).toBe("Email")
  })

  it("observe step has no label", () => {
    const op: Op = { kind: "browser.observe" }
    const r: OpResult = { ok: true, durationMs: 40 }
    const step = summarizeStep(op, r, obs)
    expect(step.kind).toBe("browser.observe")
    expect(step.label).toBeUndefined()
  })

  it("navigate step uses url as label", () => {
    const op: Op = { kind: "browser.navigate", url: "https://example.com/x" }
    const r: OpResult = { ok: true, durationMs: 0 }
    const step = summarizeStep(op, r, obs)
    expect(step.label).toBe("https://example.com/x")
  })

  it("skipped result preserves reason", () => {
    const op: Op = { kind: "browser.click", ref: "missing" }
    const r: OpResult = { ok: false, skipped: true, reason: "ref not in observation" }
    const step = summarizeStep(op, r, obs)
    expect(step.ok).toBe(false)
    expect(step.skipped).toBe(true)
    expect(step.reason).toBe("ref not in observation")
  })

  it("halted step keeps reason text", () => {
    const op: Op = { kind: "browser.click", ref: "el12" }
    const r: OpResult = { ok: false, reason: "halted after error" }
    const step = summarizeStep(op, r, obs)
    expect(step.ok).toBe(false)
    expect(step.skipped).toBeUndefined()
    expect(step.reason).toBe("halted after error")
  })
})
