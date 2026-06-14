import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("rail icon mappings", () => {
  it("keeps current rail icons wired for Inspector, Agent, and Lexicon", () => {
    const rail = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")
    expect(rail).toContain('inspector: "search"')
    expect(rail).toContain('agentChat: "robot"')
    expect(rail).toContain('lexicon: "book-open"')
    expect(rail).not.toContain('tech: "cpu-chip"')
  })

  it("cpu-chip is a defined Leo icon", () => {
    const leo = readFileSync(join(process.cwd(), "src/components/leo.tsx"), "utf8")
    expect(leo).toContain('| "cpu-chip"') // in the LeoIconName union
    expect(leo).toContain('"cpu-chip": (') // in the ICONS map
  })
})
