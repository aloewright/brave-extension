import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { retainMemory, recallMemories, reflect } from "../src/memory"

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

  it("reflect retains a fact from a transcript", async () => {
    const env = makeEnv()
    const enc = new TextEncoder()
    ;(env.AI.run as any).mockImplementation(async (model: string) => {
      if (String(model).includes("bge")) return { data: [new Array(768).fill(0.01)] }
      // streaming completion
      return new ReadableStream({
        start(c) {
          c.enqueue(
            enc.encode(`data: ${JSON.stringify({ response: "user prefers dark mode" })}\n\n`)
          )
          c.enqueue(enc.encode("data: [DONE]\n\n"))
          c.close()
        }
      })
    })
    await reflect(env, "u1", "s1", [
      { role: "user", content: "I always use dark mode" },
      { role: "assistant", content: "noted" }
    ])
    const r = await recallMemories(env, "u1", "appearance", 5)
    expect(r.some((m) => m.kind === "reflection")).toBe(true)
  })
})
