import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { retainMemory, recallMemories } from "../src/memory"

describe("memory", () => {
  it("retains a memory to D1 and recalls it by query", async () => {
    const env = makeEnv()
    await retainMemory(env, { userId: "u1", sessionId: "s1", kind: "fact", content: "user likes TypeScript" })
    const recalled = await recallMemories(env, "u1", "what languages?", 5)
    expect(recalled.length).toBe(1)
    expect(recalled[0]!.content).toBe("user likes TypeScript")
  })

  it("scopes recall to the user", async () => {
    const env = makeEnv()
    await retainMemory(env, { userId: "u1", sessionId: null, kind: "fact", content: "A" })
    await retainMemory(env, { userId: "u2", sessionId: null, kind: "fact", content: "B" })
    const r = await recallMemories(env, "u1", "anything", 5)
    expect(r.every((m) => m.content === "A")).toBe(true)
  })

  it("returns empty when the user has no memories", async () => {
    const env = makeEnv()
    expect(await recallMemories(env, "nobody", "q", 5)).toEqual([])
  })
})
