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

  it("pages within a single tick so no messages are skipped", async () => {
    const env = makeEnv()
    vi.mocked(collectCompletion).mockReset()
    vi.mocked(collectCompletion).mockResolvedValue("a fact")
    const sess = await createSession(env, "user-page", "s")
    // 3 messages, distinct ascending created_at to exercise multi-page paging.
    for (let i = 0; i < 3; i++) {
      await env.DB.prepare(
        `INSERT INTO agent_messages (id, session_id, role, content, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
        .bind(`m${i}`, sess.id, "user", `msg ${i}`, null, 1000 + i)
        .run()
    }

    const first = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 2 })
    expect(first.usersProcessed).toBe(1)
    // page1 (2 msgs) + page2 (1 msg) => 2 distill calls in one tick.
    expect(vi.mocked(collectCompletion)).toHaveBeenCalledTimes(2)

    // Second tick: nothing new => skipped.
    vi.mocked(collectCompletion).mockClear()
    const second = await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 2 })
    expect(second.usersProcessed).toBe(0)
    expect(second.skipped).toBe(1)
    expect(vi.mocked(collectCompletion)).not.toHaveBeenCalled()
  })

  it("caps a giant message in the transcript passed to the model", async () => {
    const env = makeEnv()
    let capturedTranscript = ""
    vi.mocked(collectCompletion).mockImplementation(async (_e, _m, msgs) => {
      capturedTranscript = (msgs as Array<{ role: string; content: string }>)[1]!.content
      return "ok"
    })
    const sess = await createSession(env, "user-big", "s")
    await insertMessage(env, {
      sessionId: sess.id,
      role: "user",
      content: "x".repeat(5000),
      model: null
    })
    await consolidateMemories(env, { maxUsers: 10, maxMessagesPerUser: 50 })
    // "user: " prefix + 500 chars + "…"
    expect(capturedTranscript.length).toBeLessThanOrEqual(520)
    expect(capturedTranscript).toContain("…")
  })
})
