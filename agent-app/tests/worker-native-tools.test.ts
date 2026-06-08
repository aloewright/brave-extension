import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { workerNativeSource } from "../src/tools/worker-native"
import { createSession, insertMessage } from "../src/db"

describe("workerNativeSource", () => {
  it("exposes the expected tools and connected status", async () => {
    const env = makeEnv()
    const src = workerNativeSource(env, "user-1")
    const names = (await src.listTools()).map((t) => t.name).sort()
    expect(names).toContain("searchMemory")
    expect(names).toContain("rememberFact")
    expect(names).toContain("listSessions")
    expect(names).toContain("getMessages")
    expect((await src.status()).state).toBe("connected")
  })
  it("listSessions returns only the caller's sessions", async () => {
    const env = makeEnv()
    await createSession(env, "user-1", "mine")
    await createSession(env, "user-2", "theirs")
    const src = workerNativeSource(env, "user-1")
    const tool = (await src.listTools()).find((t) => t.name === "listSessions")!
    const out = (await tool.server({})) as { sessions: Array<{ title: string }> }
    expect(out.sessions.every((s) => s.title === "mine")).toBe(true)
  })
  it("getMessages enforces ownership", async () => {
    const env = makeEnv()
    const sess = await createSession(env, "user-2", "theirs")
    await insertMessage(env, { sessionId: sess.id, role: "user", content: "hi", model: null })
    const src = workerNativeSource(env, "user-1")
    const tool = (await src.listTools()).find((t) => t.name === "getMessages")!
    await expect(tool.server({ sessionId: sess.id })).rejects.toThrow(/not found|forbidden/i)
  })
  it("webFetch rejects internal/private/metadata hosts", async () => {
    const env = makeEnv()
    const src = workerNativeSource(env, "user-1")
    const tool = (await src.listTools()).find((t) => t.name === "webFetch")!
    await expect(tool.server({ url: "http://169.254.169.254/" })).rejects.toThrow(/internal|private/i)
    await expect(tool.server({ url: "http://127.0.0.1/" })).rejects.toThrow(/internal|private/i)
  })
})
