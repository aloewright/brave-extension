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

  it("uses the shared fly-mail task API from the extension origin", () => {
    const source = readFileSync(
      join(process.cwd(), "src/sections/tasks/TasksSection.tsx"),
      "utf8"
    )

    expect(source).toContain('const MAIL_TASKS_API_BASE = "https://mail.fly.pm/api/v1"')
    expect(source).toContain('credentials: "include"')
    expect(source).toContain('requestJson<{ tasks?: SharedTask[] }>("/tasks")')
    expect(source).toContain('method: "POST"')
    expect(source).toContain('method: "DELETE"')
    expect(source).toContain("Timed items appear on Calendar.")
  })
})
