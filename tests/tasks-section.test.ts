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
    const proxy = readFileSync(
      join(process.cwd(), "src/background/cal-tasks-proxy.ts"),
      "utf8"
    )

    expect(source).toContain('type: "TASKS_API_REQUEST"')
    expect(source).toContain('requestJson<{ tasks?: SharedTask[] }>("/tasks-data")')
    expect(source).toContain('method: "POST"')
    expect(source).toContain('method: "DELETE"')
    expect(source).toContain("Timed items appear on Calendar.")
    // CAL_TASKS_API_BASE moved out of background.ts into the cal-tasks-proxy module
    // when the cal-tab fetch proxy was introduced. Verify the constant + import.
    expect(proxy).toContain('export const CAL_TASKS_API_BASE = "https://cal.fly.pm"')
    expect(background).toMatch(/from\s+["']\.\/background\/cal-tasks-proxy["']/)
    expect(background).toContain("getCalFlyPmCookieHeader")
    expect(background).toContain("headers.cookie = cookieHeader")
    expect(background).toContain('if (method !== "GET" && typeof message.init?.body === "string")')
    expect(background).toContain('credentials: "include"')
    // Forwarding ALL cookies the browser would send (no name whitelist) is
    // required so __Host-/__Secure- prefixed better-auth session cookies and
    // the CSRF cookie reach cal.fly.pm. Filtering by name caused 401s.
    expect(background).not.toContain("CAL_SESSION_COOKIE_NAMES")
    expect(background).toMatch(
      /cookies\.map\(\(cookie\) => `\$\{cookie\.name\}=\$\{cookie\.value\}`\)\.join\("; "\)/,
    )
    // Cal-tab proxy bug fix: args must be JSON-serializable so body coerces
    // to "" when missing. Regression catch.
    expect(proxy).toMatch(/args:\s*\[path,\s*method,\s*headers,\s*body\s*\?\?\s*""\]/)
  })
})
