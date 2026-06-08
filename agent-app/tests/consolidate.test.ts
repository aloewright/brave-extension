import { describe, expect, it, vi } from "vitest"
import { makeEnv } from "./helpers"
import { createSession, insertMessage } from "../src/db"
import { consolidateMemories } from "../src/cron/consolidate"

// collectCompletion drains a ReadableStream of SSE text deltas; the env.AI.run
// mock returns a plain {response} object, which the real parser can't consume.
// Mock collectCompletion directly so the cron logic is what's under test.
vi.mock("../src/chat", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>
  return { ...actual, collectCompletion: vi.fn() }
})
import { collectCompletion } from "../src/chat"

describe("consolidateMemories", () => {
  it("is watermark-gated and idempotent", async () => {
    const env = makeEnv()
    vi.mocked(collectCompletion).mockResolvedValue("User likes dark mode.")
    const sess = await createSession(env, "user-1", "s")
    await insertMessage(env, { sessionId: sess.id, role: "user", content: "I prefer dark mode", model: null })
    const first = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    expect(first.usersProcessed).toBe(1)
    const second = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    expect(second.usersProcessed).toBe(0)
    expect(second.skipped).toBe(1)
  })

  it("skips users whose distilled text is NONE", async () => {
    const env = makeEnv()
    vi.mocked(collectCompletion).mockResolvedValue("none")
    const sess = await createSession(env, "user-none", "s")
    await insertMessage(env, { sessionId: sess.id, role: "user", content: "hi", model: null })
    const res = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    // watermark still advances; user counted as processed, but no memory retained
    expect(res.usersProcessed).toBe(1)
    const mem = await env.DB.prepare("SELECT COUNT(*) AS c FROM agent_memories").first<{ c: number }>()
    expect(mem?.c).toBe(0)
  })

  it("logs and continues when one user fails", async () => {
    const env = makeEnv()
    const sess = await createSession(env, "user-2", "s")
    await insertMessage(env, { sessionId: sess.id, role: "user", content: "hi", model: null })
    vi.mocked(collectCompletion).mockRejectedValue(new Error("model down"))
    const res = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    expect(res.usersProcessed).toBe(0)
    expect(res.usersFailed).toBe(1)
  })
})
