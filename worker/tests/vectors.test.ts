import { describe, expect, it, type Mock } from "vitest"
import { makeEnv } from "./helpers"
import { chunkAndEmbed, upsertFor, deleteFor, search, vectorIdFor } from "../src/vectors"

describe("vectors", () => {
  it("computes a deterministic vector id", () => {
    expect(vectorIdFor("conversation", "abc", 0)).toBe("conversation:abc:0")
    expect(vectorIdFor("link", "01HV", 12)).toBe("link:01HV:12")
  })

  it("chunkAndEmbed returns one embedding per chunk", async () => {
    const env = makeEnv()
    const chunks = await chunkAndEmbed(env, "hello world", { maxChars: 5, overlapChars: 1 })
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[0]).toHaveProperty("text")
    expect(chunks[0]).toHaveProperty("values")
  })

  it("upsertFor writes vectors with type+id namespacing and metadata", async () => {
    const env = makeEnv()
    const result = await upsertFor(env, "link", "L1", "hello world", {
      title: "T", createdAt: 1, maxChars: 50, overlapChars: 5
    })
    expect(result.chunkCount).toBeGreaterThan(0)
    expect(env.VECTORS.upsert).toHaveBeenCalledTimes(1)
    const call = (env.VECTORS.upsert as Mock).mock.calls[0]
    if (!call) throw new Error("upsert was not called")
    const arg = call[0] as VectorizeVector[]
    expect(arg[0]!.id).toBe("link:L1:0")
    expect(arg[0]!.metadata).toMatchObject({ type: "link", id: "L1", title: "T", createdAt: 1, chunkIndex: 0 })
  })

  it("deleteFor removes all vectors for a resource by chunk_count", async () => {
    const env = makeEnv()
    await deleteFor(env, "link", "L1", 3)
    expect(env.VECTORS.deleteByIds).toHaveBeenCalledWith(["link:L1:0", "link:L1:1", "link:L1:2"])
  })

  it("deleteFor is a no-op when chunkCount is 0", async () => {
    const env = makeEnv()
    await deleteFor(env, "link", "L1", 0)
    expect(env.VECTORS.deleteByIds).not.toHaveBeenCalled()
  })

  it("search embeds the query and returns Vectorize matches", async () => {
    const env = makeEnv()
    await upsertFor(env, "link", "L1", "hello", { title: "T", createdAt: 1, maxChars: 50, overlapChars: 5 })
    const hits = await search(env, "hello", { limit: 5 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]).toHaveProperty("score")
    expect(hits[0]).toHaveProperty("metadata")
  })
})
