import { describe, expect, it } from "vitest"
import { embed } from "../src/ai"
import { makeEnv } from "./helpers"
import { EMBED_DIMS } from "../src/env"

describe("embed", () => {
  it("returns one vector per input string", async () => {
    const env = makeEnv()
    const out = await embed(env, ["hello", "world"])
    expect(out).toHaveLength(2)
    expect(out[0]).toHaveLength(EMBED_DIMS)
    expect(out[1]).toHaveLength(EMBED_DIMS)
  })

  it("accepts a single string and returns a single vector", async () => {
    const env = makeEnv()
    const out = await embed(env, "hi")
    expect(out).toHaveLength(1)
  })

  it("returns [] for empty input", async () => {
    const env = makeEnv()
    expect(await embed(env, [])).toEqual([])
  })

  it("passes gateway id 'x' on every call", async () => {
    const env = makeEnv()
    await embed(env, "test")
    expect(env.AI.run).toHaveBeenCalledWith(
      "@cf/baai/bge-base-en-v1.5",
      { text: ["test"] },
      { gateway: { id: "x" } }
    )
  })
})
