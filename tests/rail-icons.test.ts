import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

describe("rail icon mappings", () => {
  it("Tech uses the cpu-chip icon and Agent uses the robot icon", () => {
    const rail = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")
    expect(rail).toContain('tech: "cpu-chip"')
    expect(rail).toContain('agentChat: "robot"')
  })

  it("cpu-chip is a defined Leo icon", () => {
    const leo = readFileSync(join(process.cwd(), "src/components/leo.tsx"), "utf8")
    expect(leo).toContain('| "cpu-chip"') // in the LeoIconName union
    expect(leo).toContain('"cpu-chip": (') // in the ICONS map
  })
})
