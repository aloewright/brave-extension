import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

describe("page agent UI boundary", () => {
  it("keeps the old floating page-agent content script out of the custom build", () => {
    expect(existsSync(join(process.cwd(), "src/contents/page-agent.ts"))).toBe(false)
    expect(readFileSync(join(process.cwd(), "scripts/build-extension.mjs"), "utf8")).not.toContain(
      "page-agent"
    )
  })

  it("persists sidebar cloud visibility even when the active tab cannot receive messages", async () => {
    vi.resetModules()
    const chromeMock = (globalThis as any).chrome
    chromeMock.windows = {
      getLastFocused: vi.fn(async () => ({ id: 1 }))
    }
    chromeMock.tabs = {
      query: vi.fn(async () => [{ id: 123 }]),
      sendMessage: vi.fn(async () => {
        throw new Error("No receiving end")
      })
    }

    const { runPageAgentQuickAction } = await import("../src/lib/quick-actions")

    await expect(runPageAgentQuickAction()).resolves.toEqual({
      kind: "success",
      message: "Page agent hidden"
    })
    expect(chromeMock.storage.local.__dump()["pageAgent.visible"]).toBe(false)

    await expect(runPageAgentQuickAction()).resolves.toEqual({
      kind: "success",
      message: "Page agent shown"
    })
    expect(chromeMock.storage.local.__dump()["pageAgent.visible"]).toBe(true)
    expect(chromeMock.tabs.sendMessage).toHaveBeenCalledWith(123, {
      type: "PAGE_AGENT_TOGGLE",
      visible: false
    })
  })

  it("delegates ref-safety and action execution to executeProgram from page-agent-program", () => {
    const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")

    expect(background).not.toContain("selectorForAgentAction")
    expect(background).not.toContain("friendlyPageAgentActionError")
    expect(background).not.toContain("replyWithActionResult")
    expect(background).toContain("executeProgram")
    expect(background).toContain("parseProgram")
    expect(background).toMatch(/from\s+["']\.\/background\/page-agent-program["']/)
  })

  it("falls back locally when cloud page-agent chat fails", () => {
    const background = readFileSync(join(process.cwd(), "src/background.ts"), "utf8")

    expect(background).toContain("page agent cloud chat failed; using local fallback")
    expect(background).toContain("local-deterministic")
  })
})
