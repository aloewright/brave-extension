import { describe, expect, it } from "vitest"
import { codeExecGuard } from "../src/routes/code-exec-guard"

describe("code-exec guard", () => {
  it("rejects missing/incorrect bearer", () => {
    expect(codeExecGuard("Bearer secret", "secret")).toBe(true)
    expect(codeExecGuard("Bearer nope", "secret")).toBe(false)
    expect(codeExecGuard(undefined, "secret")).toBe(false)
    expect(codeExecGuard("Bearer secret", "")).toBe(false)
  })
})
