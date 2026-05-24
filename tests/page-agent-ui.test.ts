import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("page agent UI", () => {
  it("can be toggled from the sidebar rail through a content-script message", () => {
    const quickActions = readFileSync(
      join(process.cwd(), "src/lib/quick-actions.ts"),
      "utf8"
    )
    const pageAgent = readFileSync(
      join(process.cwd(), "src/contents/page-agent.ts"),
      "utf8"
    )

    expect(quickActions).toContain("runPageAgentQuickAction")
    expect(quickActions).toContain("PAGE_AGENT_TOGGLE")
    expect(pageAgent).toContain("PAGE_AGENT_TOGGLE")
    expect(pageAgent).toContain("open = !open")
  })

  it("sends chat on Enter while preserving Shift+Enter for newlines", () => {
    const pageAgent = readFileSync(
      join(process.cwd(), "src/contents/page-agent.ts"),
      "utf8"
    )

    expect(pageAgent).toContain('event.key === "Enter"')
    expect(pageAgent).toContain("event.shiftKey")
    expect(pageAgent).toContain("form.requestSubmit()")
  })

  it("shields focused chat keyboard events from website shortcuts", () => {
    const pageAgent = readFileSync(
      join(process.cwd(), "src/contents/page-agent.ts"),
      "utf8"
    )

    expect(pageAgent).toContain('["keydown", "keypress", "keyup"]')
    expect(pageAgent).toContain("window.addEventListener(type, shieldPageAgentKeyboardEvent, true)")
    expect(pageAgent).toContain("event.stopImmediatePropagation()")
    expect(pageAgent).toContain("panel.contains(active)")
    expect(pageAgent).toContain("shadow.activeElement === input")
  })

  it("uses the translucent fly.pm cloud mark instead of the old AI circle", () => {
    const pageAgent = readFileSync(
      join(process.cwd(), "src/contents/page-agent.ts"),
      "utf8"
    )

    expect(pageAgent).toContain("rgba(228,241,250,.64)")
    expect(pageAgent).toContain("M60 120C45 120 35 105 40 90")
    expect(pageAgent).not.toContain(">AI</button>")
  })
})
