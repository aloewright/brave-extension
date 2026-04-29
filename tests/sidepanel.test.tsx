import { describe, it, expect, beforeEach } from "vitest"
import {
  addMessage,
  clearMessages,
  getMessagesForBackend
} from "../src/storage"
import type { ChatMessage, CLIBackend, Settings } from "../src/types"
import { DEFAULT_SETTINGS } from "../src/types"

// Mirror the visibleMessages filter from src/sidepanel.tsx — messages without
// a backend tag fall through to the active backend, while tagged messages are
// scoped strictly to that backend. Keeping the rule in one place lets us
// regression-test the user-facing "switch backend → see only that thread"
// interaction without spinning up React/RTL.
function visibleMessages(
  messages: ChatMessage[],
  settings: Settings | null
): ChatMessage[] {
  return settings
    ? messages.filter((m) => !m.backend || m.backend === settings.backend)
    : messages
}

const makeMsg = (
  id: string,
  backend: CLIBackend | undefined,
  timestamp: number
): ChatMessage => ({
  id,
  role: "user",
  content: id,
  timestamp,
  backend
})

describe("sidepanel · backend-scoped message view", () => {
  beforeEach(async () => {
    await clearMessages()
  })

  it("only shows messages tagged with the active backend (plus untagged)", () => {
    const messages: ChatMessage[] = [
      makeMsg("c1", "claude", 1),
      makeMsg("g1", "gemini", 2),
      makeMsg("u1", undefined, 3),
      makeMsg("c2", "claude", 4)
    ]
    const visible = visibleMessages(messages, { ...DEFAULT_SETTINGS, backend: "claude" })
    expect(visible.map((m) => m.id)).toEqual(["c1", "u1", "c2"])

    const gemini = visibleMessages(messages, { ...DEFAULT_SETTINGS, backend: "gemini" })
    expect(gemini.map((m) => m.id)).toEqual(["g1", "u1"])
  })

  it("falls back to the full list when settings haven't loaded yet", () => {
    const messages = [makeMsg("a", "claude", 1), makeMsg("b", "gemini", 2)]
    expect(visibleMessages(messages, null)).toHaveLength(2)
  })

  it("backend switch + /clear leaves the other backend's history intact", async () => {
    await addMessage(makeMsg("c1", "claude", 1))
    await addMessage(makeMsg("g1", "gemini", 2))

    // User on "claude" runs /clear — sidepanel calls clearMessages(activeBackend).
    await clearMessages("claude")

    expect(await getMessagesForBackend("claude")).toEqual([])
    const gemini = await getMessagesForBackend("gemini")
    expect(gemini.map((m) => m.id)).toEqual(["g1"])
  })
})
