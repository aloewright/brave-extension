import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { SECTIONS } from "../src/sections/types"

describe("agent-chat section registration", () => {
  it("is in the SECTIONS registry", () => {
    expect(SECTIONS.map((s) => s.id)).toContain("agentChat")
  })
  it("is rendered in sidepanel.tsx", () => {
    const src = readFileSync(join(process.cwd(), "src/sidepanel.tsx"), "utf8")
    expect(src).toContain("AgentChatSection")
    expect(src).toContain('"agentChat"')
  })
  it("has a rail icon mapping", () => {
    const src = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")
    expect(src).toContain("agentChat:")
  })
})
