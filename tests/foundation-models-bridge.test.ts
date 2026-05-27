import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("native Foundation Models bridge contract", () => {
  it("exposes status, plan, compact, nextAction, and chat message types", () => {
    const source = readFileSync(join(process.cwd(), "native-host/ai-dev-host.mjs"), "utf8")
    expect(source).toContain('case "foundationModels.status"')
    expect(source).toContain('case "foundationModels.plan"')
    expect(source).toContain('case "foundationModels.compact"')
    expect(source).toContain('case "foundationModels.nextAction"')
    expect(source).toContain('case "foundationModels.chat"')
    expect(source).toContain("chatTurn: result.chatTurn")
    expect(source).toContain("runFoundationModelsBridge")
    expect(source).toContain("foundation-models-bridge.swift")
  })
})
