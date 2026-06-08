import { describe, expect, it } from "vitest"
import { EventType } from "@tanstack/ai"
import { shouldUseCodeMode, translateEvent } from "../src/agents/code-mode-turn"

describe("shouldUseCodeMode", () => {
  it("true only when supportsTools and tools exist", () => {
    expect(shouldUseCodeMode({ supportsTools: true } as any, 3)).toBe(true)
    expect(shouldUseCodeMode({ supportsTools: false } as any, 3)).toBe(false)
    expect(shouldUseCodeMode({ supportsTools: true } as any, 0)).toBe(false)
    expect(shouldUseCodeMode({} as any, 3)).toBe(false)
  })
})

describe("translateEvent", () => {
  it("maps TEXT_MESSAGE_CONTENT to a {delta} frame and accumulates text", () => {
    const r = translateEvent(
      { type: EventType.TEXT_MESSAGE_CONTENT, delta: "hello" },
      new Map()
    )
    expect(r.frames).toEqual([`data: ${JSON.stringify({ delta: "hello" })}\n\n`])
    expect(r.appendText).toBe("hello")
    expect(r.trace).toEqual([])
    expect(r.finished).toBe(false)
  })

  it("maps TOOL_CALL_START/END to tool frames and trace entries (name resolved on END)", () => {
    const names = new Map<string, string>()
    const start = translateEvent(
      { type: EventType.TOOL_CALL_START, toolCallId: "t1", toolCallName: "codeMode" },
      names
    )
    expect(start.frames).toEqual([
      `data: ${JSON.stringify({ event: "tool", name: "codeMode", status: "start" })}\n\n`
    ])
    expect(start.trace).toEqual([{ toolCallId: "t1", name: "codeMode", status: "start" }])

    // END omits the name; translator resolves it via the toolCallId map.
    const end = translateEvent({ type: EventType.TOOL_CALL_END, toolCallId: "t1" }, names)
    expect(end.frames).toEqual([
      `data: ${JSON.stringify({ event: "tool", name: "codeMode", status: "end" })}\n\n`
    ])
    expect(end.trace).toEqual([{ toolCallId: "t1", name: "codeMode", status: "end" }])
  })

  it("flags RUN_FINISHED and ignores unrelated events", () => {
    expect(translateEvent({ type: EventType.RUN_FINISHED }, new Map()).finished).toBe(true)
    const noop = translateEvent({ type: EventType.TEXT_MESSAGE_START }, new Map())
    expect(noop.frames).toEqual([])
    expect(noop.appendText).toBe("")
  })
})
