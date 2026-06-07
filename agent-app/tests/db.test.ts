import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import {
  createSession,
  listSessions,
  insertMessage,
  listMessages
} from "../src/db"

describe("db", () => {
  it("creates and lists sessions for a user", async () => {
    const env = makeEnv()
    const s = await createSession(env, "user-a", "First chat")
    expect(s.id).toBeTruthy()
    const list = await listSessions(env, "user-a")
    expect(list).toHaveLength(1)
    expect(list[0]!.title).toBe("First chat")
  })

  it("scopes sessions by user", async () => {
    const env = makeEnv()
    await createSession(env, "user-a", "A")
    await createSession(env, "user-b", "B")
    expect(await listSessions(env, "user-a")).toHaveLength(1)
  })

  it("inserts and lists messages in created_at order", async () => {
    const env = makeEnv()
    const s = await createSession(env, "user-a", "chat")
    await insertMessage(env, { sessionId: s.id, role: "user", content: "hi", model: null })
    await insertMessage(env, {
      sessionId: s.id,
      role: "assistant",
      content: "hello",
      model: "echo"
    })
    const msgs = await listMessages(env, s.id)
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant"])
    expect(msgs[1]!.model).toBe("echo")
  })
})
