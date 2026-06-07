import { describe, it, expect, beforeEach } from "vitest"
import { observe, elementReady } from "../../src/lib/github/observe"

beforeEach(() => { document.body.innerHTML = "" })

describe("observe", () => {
  it("calls back for existing and future matches once each", async () => {
    document.body.append(Object.assign(document.createElement("div"), { className: "t" }))
    const seen: Element[] = []
    const ctrl = new AbortController()
    observe(".t", (node) => seen.push(node), { signal: ctrl.signal })
    await Promise.resolve()
    const later = Object.assign(document.createElement("div"), { className: "t" })
    document.body.append(later)
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.length).toBe(2)
    // Idempotent: a processed node is not re-reported
    document.body.append(document.createElement("span"))
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.length).toBe(2)
    ctrl.abort()
  })

  it("stops after abort", async () => {
    const seen: Element[] = []
    const ctrl = new AbortController()
    observe(".t", (n) => seen.push(n), { signal: ctrl.signal })
    ctrl.abort()
    document.body.append(Object.assign(document.createElement("div"), { className: "t" }))
    await new Promise((r) => setTimeout(r, 10))
    expect(seen.length).toBe(0)
  })

  it("elementReady resolves when present", async () => {
    setTimeout(() => {
      document.body.append(Object.assign(document.createElement("div"), { id: "late" }))
    }, 5)
    const found = await elementReady("#late", { timeout: 200 })
    expect(found?.id).toBe("late")
  })
})
