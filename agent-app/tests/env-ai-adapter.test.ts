import { describe, expect, it, vi } from "vitest"
import { EventType } from "@tanstack/ai"
import { envAiAdapter } from "../src/ai/env-ai-adapter"
import type { Env } from "../src/env"

// Build a ReadableStream of SSE bytes from raw line strings.
function sseStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const l of lines) controller.enqueue(encoder.encode(l + "\n"))
      controller.close()
    }
  })
}

// Minimal TextOptions stub — only the fields the adapter reads.
function makeOptions(extra: Record<string, unknown> = {}) {
  return {
    model: "test-model",
    messages: [{ role: "user", content: "hi" }],
    logger: {
      request: () => {},
      provider: () => {},
      errors: () => {}
    },
    ...extra
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any
}

async function collect(iter: AsyncIterable<any>) {
  const out: any[] = []
  for await (const ev of iter) out.push(ev)
  return out
}

function makeEnvWithRun(run: ReturnType<typeof vi.fn>): Env {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { AI: { run } } as any
}

describe("envAiAdapter", () => {
  it("calls env.AI.run with the model, stream:true, and gateway id 'x'", async () => {
    const run = vi.fn(async () => sseStream(['data: {"response":"hi"}', "data: [DONE]"]))
    const env = makeEnvWithRun(run)
    const adapter = envAiAdapter(env, "@cf/test/model")
    await collect(adapter.chatStream(makeOptions()))

    expect(run).toHaveBeenCalledWith(
      "@cf/test/model",
      expect.objectContaining({ stream: true }),
      { gateway: { id: "x" } }
    )
  })

  it("translates {response} SSE deltas into AG-UI text events bracketed by RUN_STARTED/RUN_FINISHED", async () => {
    const run = vi.fn(async () =>
      sseStream(['data: {"response":"Hel"}', 'data: {"response":"lo"}', "data: [DONE]"])
    )
    const adapter = envAiAdapter(makeEnvWithRun(run), "@cf/test/model")
    const events = await collect(adapter.chatStream(makeOptions()))

    expect(events[0].type).toBe(EventType.RUN_STARTED)
    expect(events[events.length - 1].type).toBe(EventType.RUN_FINISHED)

    const text = events
      .filter((e) => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((e) => e.delta)
      .join("")
    expect(text).toBe("Hello")

    // start/end bookend the content
    const starts = events.filter((e) => e.type === EventType.TEXT_MESSAGE_START)
    const ends = events.filter((e) => e.type === EventType.TEXT_MESSAGE_END)
    expect(starts).toHaveLength(1)
    expect(ends).toHaveLength(1)
    expect(starts[0].role).toBe("assistant")
    expect(starts[0].messageId).toBe(ends[0].messageId)
  })

  it("emits TOOL_CALL_START / ARGS / END from streamed tool_calls fragments", async () => {
    const run = vi.fn(async () =>
      sseStream([
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":"{\\"loc"}}]}}]}',
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ation\\":\\"NYC\\"}"}}]}}]}',
        "data: [DONE]"
      ])
    )
    const adapter = envAiAdapter(makeEnvWithRun(run), "@cf/test/model")
    const events = await collect(adapter.chatStream(makeOptions()))

    const start = events.find((e) => e.type === EventType.TOOL_CALL_START)
    expect(start).toBeTruthy()
    expect(start.toolCallName).toBe("get_weather")
    expect(start.toolCallId).toBe("call_1")

    const args = events
      .filter((e) => e.type === EventType.TOOL_CALL_ARGS && e.toolCallId === "call_1")
      .map((e) => e.delta)
      .join("")
    expect(JSON.parse(args)).toEqual({ location: "NYC" })

    expect(events.some((e) => e.type === EventType.TOOL_CALL_END)).toBe(true)
  })

  it("passes OpenAI-style tools array when options.tools is present", async () => {
    const run = vi.fn(async () => sseStream(["data: [DONE]"]))
    const env = makeEnvWithRun(run)
    const adapter = envAiAdapter(env, "@cf/test/model")
    await collect(
      adapter.chatStream(
        makeOptions({
          tools: [
            {
              name: "get_weather",
              description: "Get weather",
              inputSchema: { type: "object", properties: { location: { type: "string" } } }
            }
          ]
        })
      )
    )
    const body = (run.mock.calls[0] as unknown as any[])[1]
    expect(body.tools).toEqual([
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: { location: { type: "string" } } }
        }
      }
    ])
  })
})
