import { describe, expect, it, vi } from "vitest"
import { makeEnv } from "./helpers"
import { collectCompletion } from "../src/chat"

// Helper: a fake Workers-AI streaming response (ReadableStream of SSE-like chunks).
function fakeStream(parts: string[]): ReadableStream {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder()
      for (const p of parts) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ response: p })}\n\n`))
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"))
      controller.close()
    }
  })
}

describe("streamCompletion", () => {
  it("aggregates Workers-AI stream deltas into final text", async () => {
    const env = makeEnv({
      AI: { run: vi.fn(async () => fakeStream(["Hel", "lo", " world"])) } as any
    })
    const text = await collectCompletion(env, "@cf/openai/gpt-oss-120b", [
      { role: "user", content: "hi" }
    ], false)
    expect(text).toBe("Hello world")
  })

  it("passes the gateway id to env.AI.run for workers-ai models", async () => {
    const run = vi.fn(async () => fakeStream(["ok"]))
    const env = makeEnv({ AI: { run } as any })
    await collectCompletion(env, "@cf/openai/gpt-oss-120b", [{ role: "user", content: "x" }], false)
    expect(run).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-120b",
      expect.objectContaining({ stream: true }),
      expect.objectContaining({ gateway: { id: "x" } })
    )
  })
})
