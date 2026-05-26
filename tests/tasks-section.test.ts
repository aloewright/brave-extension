import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { SECTIONS, type SectionId } from "../src/sections/types"

describe("tasks section", () => {
  it("adds Tasks as its own sidepanel rail tab", () => {
    const ids = SECTIONS.map((section) => section.id)
    expect(ids).toContain<SectionId>("tasks")

    const sidepanelSource = readFileSync(join(process.cwd(), "src/sidepanel.tsx"), "utf8")
    const railSource = readFileSync(join(process.cwd(), "src/components/SidebarRail.tsx"), "utf8")

    expect(sidepanelSource).toContain("<TasksSection />")
    expect(railSource).toContain('tasks: "list-checks"')
  })

  it("uses the background cal.fly.pm task API bridge", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/tasks/TasksSection.tsx"),
      "utf8"
    )
    const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")

    expect(source).toContain('type: "TASKS_API_REQUEST"')
    expect(source).toContain('requestJson<{ tasks?: SharedTask[] }>("/tasks-data")')
    expect(source).toContain('method: "POST"')
    expect(source).toContain('method: "DELETE"')
    expect(source).toContain("Timed items appear on Calendar.")
    expect(background).toContain('const CAL_TASKS_API_BASE = "https://cal.fly.pm"')
    expect(background).not.toContain("headers: { ...init.headers, cookie:")
    expect(background).toContain('if (method !== "GET" && typeof message.init?.body === "string")')
    expect(background).toContain('credentials: "include"')
  })
})
