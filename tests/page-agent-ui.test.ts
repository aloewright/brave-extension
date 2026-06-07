import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

describe("page agent UI", () => {
  it("can be hidden or shown from the sidebar rail without opening chat", () => {
    const quickActions = readFileSync(
      join(process.cwd(), "src/lib/quick-actions.ts"),
      "utf8"
    )
    const pageAgent = readFileSync(
      join(process.cwd(), "src/contents/page-agent.ts"),
      "utf8"
    )

    expect(quickActions).toContain("runPageAgentQuickAction")
    expect(quickActions).toContain('const PAGE_AGENT_VISIBLE_KEY = "pageAgent.visible"')
    expect(quickActions).toContain("chrome.storage.local.set({ [PAGE_AGENT_VISIBLE_KEY]: visible })")
    expect(quickActions).toContain("PAGE_AGENT_TOGGLE")
    expect(pageAgent).toContain("PAGE_AGENT_TOGGLE")
    expect(pageAgent).toContain('const PAGE_AGENT_VISIBLE_KEY = "pageAgent.visible"')
    expect(pageAgent).toContain('typeof message.visible === "boolean"')
    expect(pageAgent).toContain("? message.visible : !visible")
    expect(pageAgent).toContain("if (!visible) open = false")
    expect(pageAgent).toContain("sendResponse({ ok: true, visible, open })")
    expect(pageAgent).toContain("chrome.storage?.onChanged?.addListener")
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

  it("opens chat only from the floating cloud popup", () => {
    const pageAgent = readFileSync(
      join(process.cwd(), "src/contents/page-agent.ts"),
      "utf8"
    )

    expect(pageAgent).toContain('toggle.addEventListener("click"')
    expect(pageAgent).toContain("open = !open")
    expect(pageAgent).toContain('toggle.style.display = visible && !open ? "inline-grid" : "none"')
  })

  it("keeps sidebar cloud visibility separate from floating cloud chat open", async () => {
    vi.resetModules()
    document.body.innerHTML = ""
    document.head.innerHTML = ""

    let messageListener:
      | ((message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean)
      | undefined
    let shadow: ShadowRoot | undefined
    const originalAttachShadow = Element.prototype.attachShadow
    const attachShadow = vi
      .spyOn(Element.prototype, "attachShadow")
      .mockImplementation(function (this: Element, init: ShadowRootInit) {
        shadow = originalAttachShadow.call(this, { ...init, mode: "open" })
        return shadow
      })

    ;(globalThis as any).chrome = {
      ...(globalThis as any).chrome,
      runtime: {
        lastError: undefined,
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn((listener) => {
            messageListener = listener
          })
        }
      }
    }

    try {
      await import("../src/contents/page-agent")

      const sendToggle = () => {
        let response: unknown
        const handled = messageListener?.(
          { type: "PAGE_AGENT_TOGGLE" },
          {},
          (next) => {
            response = next
          }
        )
        return { handled, response }
      }

      expect(shadow).toBeDefined()
      const root = shadow!.querySelector<HTMLElement>(".root")!
      const launcher = shadow!.querySelector<HTMLButtonElement>(".toggle")!
      const panel = shadow!.querySelector<HTMLElement>(".panel")!

      expect(root.style.display).toBe("block")
      expect(launcher.style.display).toBe("inline-grid")
      expect(panel.dataset.open).toBe("false")

      expect(sendToggle()).toEqual({
        handled: false,
        response: { ok: true, visible: false, open: false }
      })
      expect(root.style.display).toBe("none")
      expect(launcher.style.display).toBe("none")
      expect(panel.dataset.open).toBe("false")

      expect(sendToggle()).toEqual({
        handled: false,
        response: { ok: true, visible: true, open: false }
      })
      expect(root.style.display).toBe("block")
      expect(launcher.style.display).toBe("inline-grid")
      expect(panel.dataset.open).toBe("false")

      launcher.click()
      expect(root.style.display).toBe("block")
      expect(launcher.style.display).toBe("none")
      expect(panel.dataset.open).toBe("true")

      expect(sendToggle()).toEqual({
        handled: false,
        response: { ok: true, visible: false, open: false }
      })
      expect(root.style.display).toBe("none")
      expect(panel.dataset.open).toBe("false")
    } finally {
      attachShadow.mockRestore()
    }
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

  it("delegates ref-safety and action execution to executeProgram from page-agent-program", () => {
    const background = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8"
    )

    // Old single-action helpers were deleted; ref safety now lives in page-agent-program
    expect(background).not.toContain("selectorForAgentAction")
    expect(background).not.toContain("friendlyPageAgentActionError")
    expect(background).not.toContain("replyWithActionResult")
    // New wiring delegates to executeProgram
    expect(background).toContain("executeProgram")
    expect(background).toContain("parseProgram")
    expect(background).toMatch(/from\s+["']\.\/background\/page-agent-program["']/)
  })

  it("falls back locally when cloud page-agent chat fails", () => {
    const background = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8"
    )

    expect(background).toContain("page agent cloud chat failed; using local fallback")
    expect(background).toContain("local-deterministic")
  })
})
