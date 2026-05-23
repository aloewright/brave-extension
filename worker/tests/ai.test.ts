import { describe, expect, it, vi } from "vitest"
import { embed, transcribeAudio, ocrImage } from "../src/ai"
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

describe("transcribeAudio", () => {
  it("routes whisper through gateway 'x' and returns trimmed text", async () => {
    const env = makeEnv({
      AI: { run: vi.fn(async () => ({ text: "  hello from whisper  " })) } as unknown as Ai
    })
    const out = await transcribeAudio(env, new Uint8Array([1, 2, 3]))
    expect(out).toBe("hello from whisper")
    expect(env.AI.run).toHaveBeenCalledWith(
      "@cf/openai/whisper",
      { audio: [1, 2, 3] },
      { gateway: { id: "x" } }
    )
  })

  it("returns empty string when the model returns nothing", async () => {
    const env = makeEnv({
      AI: { run: vi.fn(async () => ({})) } as unknown as Ai
    })
    expect(await transcribeAudio(env, new Uint8Array([1]))).toBe("")
  })
})

describe("ocrImage", () => {
  it("routes the vision model through gateway 'x' and returns response text", async () => {
    const env = makeEnv({
      AI: { run: vi.fn(async () => ({ description: "page text" })) } as unknown as Ai
    })
    const out = await ocrImage(env, new Uint8Array([1, 2]))
    expect(out).toBe("page text")
    const call = (env.AI.run as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(call?.[0]).toBe("@cf/llava-hf/llava-1.5-7b-hf")
    expect(call?.[2]).toEqual({ gateway: { id: "x" } })
  })

  it("falls back to the response field when description is missing", async () => {
    const env = makeEnv({
      AI: { run: vi.fn(async () => ({ response: "alt text" })) } as unknown as Ai
    })
    expect(await ocrImage(env, new Uint8Array([1]))).toBe("alt text")
  })
})
