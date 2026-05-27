import { describe, it, expect } from "vitest"
import {
  buildSystemPrompt,
  toBridgeHistory
} from "../src/background/native-host-bridge"
import type {
  AmbientContext,
  ChatMessage,
  ToolDefinition
} from "../src/lib/ai-chat-types"

function dummyTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description,
    parametersSchema: { type: "object", properties: {} },
    async execute() {
      return { ok: true }
    }
  }
}

describe("buildSystemPrompt", () => {
  const tools: ToolDefinition[] = [
    dummyTool("joplin.ping", "Check Joplin reachability."),
    dummyTool("context.activeTab", "Get active tab url+title.")
  ]

  it("lists all tool names with descriptions", () => {
    const out = buildSystemPrompt("", tools, {})
    expect(out).toContain("joplin.ping: Check Joplin reachability.")
    expect(out).toContain("context.activeTab: Get active tab url+title.")
  })

  it("includes the ambient activeTab line when present", () => {
    const ambient: AmbientContext = {
      activeTab: { url: "http://x.test/p", title: "Page" }
    }
    const out = buildSystemPrompt("", tools, ambient)
    expect(out).toContain("CURRENT STATE")
    expect(out).toContain("Active tab")
    expect(out).toContain("http://x.test/p")
  })

  it("omits CURRENT STATE when ambient is empty", () => {
    const out = buildSystemPrompt("", tools, {})
    expect(out).not.toContain("CURRENT STATE")
  })

  it("includes the compacted-head block when summary is non-empty", () => {
    const out = buildSystemPrompt("earlier conv summary", tools, {})
    expect(out).toContain("EARLIER CONVERSATION")
    expect(out).toContain("earlier conv summary")
  })

  it("includes the mostRecentClip line when present", () => {
    const ambient: AmbientContext = {
      mostRecentClip: {
        title: "Clip A",
        mode: "simplified",
        createdAt: "2026-05-27T00:00:00Z",
        joplinUrl: "joplin://x"
      }
    }
    const out = buildSystemPrompt("", tools, ambient)
    expect(out).toContain('"Clip A"')
    expect(out).toContain("simplified")
  })
})

describe("toBridgeHistory", () => {
  function userMsg(text: string): ChatMessage {
    return {
      id: "u1",
      role: "user",
      content: text,
      turnId: "t",
      createdAt: ""
    }
  }
  function asstToolCall(): ChatMessage {
    return {
      id: "a1",
      role: "assistant",
      content: "",
      turnId: "t",
      createdAt: "",
      toolCall: {
        id: "c1",
        name: "joplin.ping",
        arguments: {},
        argumentsRaw: '{"foo":1}'
      }
    }
  }
  function toolRes(error?: string): ChatMessage {
    return {
      id: "tr1",
      role: "tool",
      content: '{"ok":true}',
      toolCallId: "c1",
      toolError: error,
      turnId: "t",
      createdAt: ""
    }
  }

  it("maps user messages by role + content", () => {
    const out = toBridgeHistory(userMsg("hello"))
    expect(out).toEqual({ role: "user", content: "hello" })
  })

  it("maps assistant tool-call messages preserving argumentsRaw", () => {
    const out = toBridgeHistory(asstToolCall())
    expect(out.role).toBe("assistant")
    expect(out.toolName).toBe("joplin.ping")
    expect(out.toolArguments).toBe('{"foo":1}')
  })

  it("maps tool result messages preserving toolError when set", () => {
    const out = toBridgeHistory(toolRes("boom"))
    expect(out.role).toBe("tool")
    expect(out.content).toBe('{"ok":true}')
    expect(out.toolCallId).toBe("c1")
    expect(out.toolError).toBe("boom")
  })
})
