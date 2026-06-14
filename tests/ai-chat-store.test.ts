import { describe, it, expect, beforeEach, vi } from "vitest"
import type { ChatMessage } from "../src/lib/ai-chat-types"

import {
  getConversation,
  appendMessage,
  updateMessage,
  clearConversation,
  setCompactedHead
} from "../src/lib/ai-chat-store"

function makeMsg(id: string, role: ChatMessage["role"] = "user"): ChatMessage {
  return {
    id,
    role,
    content: `content-${id}`,
    turnId: "t-" + id,
    createdAt: new Date(1_700_000_000_000).toISOString()
  }
}

describe("ai-chat-store", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("getConversation returns empty on cold start", async () => {
    expect(await getConversation()).toEqual({ messages: [] })
  })

  it("appendMessage round-trips a single message", async () => {
    await appendMessage(makeMsg("a"))
    const conv = await getConversation()
    expect(conv.messages.length).toBe(1)
    expect(conv.messages[0].id).toBe("a")
  })

  it("appendMessage preserves chronological order across appends", async () => {
    await appendMessage(makeMsg("a"))
    await appendMessage(makeMsg("b"))
    await appendMessage(makeMsg("c"))
    const conv = await getConversation()
    expect(conv.messages.map((m) => m.id)).toEqual(["a", "b", "c"])
  })

  it("updateMessage patches in place without reorder", async () => {
    await appendMessage(makeMsg("a"))
    await appendMessage(makeMsg("b"))
    await updateMessage("a", { content: "patched" })
    const conv = await getConversation()
    expect(conv.messages[0].content).toBe("patched")
    expect(conv.messages[1].id).toBe("b")
  })

  it("updateMessage with unknown id no-ops", async () => {
    await appendMessage(makeMsg("a"))
    await updateMessage("zzz", { content: "wat" })
    const conv = await getConversation()
    expect(conv.messages[0].content).toBe("content-a")
  })

  it("clearConversation empties messages", async () => {
    await appendMessage(makeMsg("a"))
    await clearConversation()
    expect(await getConversation()).toEqual({ messages: [] })
  })

  it("setCompactedHead persists summary and truncatedThrough", async () => {
    await appendMessage(makeMsg("a"))
    await setCompactedHead("a-summary", "a")
    const conv = await getConversation()
    expect(conv.compactedHead).toEqual({ summary: "a-summary", truncatedThrough: "a" })
    // messages array preserved
    expect(conv.messages.map((m) => m.id)).toEqual(["a"])
  })
})
