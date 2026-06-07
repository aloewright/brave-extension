import type { Env } from "./env"
import { AI_GATEWAY_ID } from "./env"
import { log, since } from "./log"

export interface ChatMsg {
  role: "system" | "user" | "assistant"
  content: string
}

/**
 * Stream a completion through AI Gateway "x" and return a ReadableStream of
 * plain text deltas (UTF-8). Workers AI models use env.AI.run directly — the
 * only Worker-side gateway path that works today (see ~/.claude/CLAUDE.md
 * "Inside a Worker"). Advanced (non-CF) ids use the gateway compat run behind
 * the `advanced` flag; this path is experimental until the dynamic-route Worker
 * bug is fixed upstream.
 */
export function streamCompletion(
  env: Env,
  modelId: string,
  messages: ChatMsg[],
  advanced: boolean
): Promise<ReadableStream<Uint8Array>> {
  if (advanced) return streamAdvanced(env, modelId, messages)
  return streamWorkersAi(env, modelId, messages)
}

async function streamWorkersAi(
  env: Env,
  modelId: string,
  messages: ChatMsg[]
): Promise<ReadableStream<Uint8Array>> {
  // CLAUDE.md sanctioned Worker-side gateway call. Swap to dynamic/text_gen
  // when the binding/dynamic-route path is fixed upstream.
  const startedAt = Date.now()
  log.info("ai.call.start", {
    path: "workers-ai",
    modelId,
    gateway: AI_GATEWAY_ID,
    messageCount: messages.length
  })
  try {
    const raw = (await env.AI.run(
      modelId,
      { messages, stream: true },
      { gateway: { id: AI_GATEWAY_ID } }
    )) as unknown as ReadableStream
    log.info("ai.call.opened", { path: "workers-ai", modelId, ms: since(startedAt) })
    return toTextDeltaStream(raw)
  } catch (err) {
    log.error("ai.call.error", {
      path: "workers-ai",
      modelId,
      ms: since(startedAt),
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }
}

async function streamAdvanced(
  env: Env,
  modelId: string,
  messages: ChatMsg[]
): Promise<ReadableStream<Uint8Array>> {
  // EXPERIMENTAL: explicit non-CF model via gateway compat. Observed to skip
  // fallback nodes for dynamic routes, but a single explicit model has no
  // chain to skip. See ~/.claude/CLAUDE.md "Inside a Worker".
  const startedAt = Date.now()
  log.info("ai.call.start", {
    path: "advanced",
    modelId,
    gateway: AI_GATEWAY_ID,
    messageCount: messages.length
  })
  try {
    const gw = (env.AI as unknown as {
      gateway: (id: string) => {
        run: (opts: unknown) => Promise<ReadableStream>
      }
    }).gateway(AI_GATEWAY_ID)
    const raw = await gw.run({
      provider: "compat",
      endpoint: "chat/completions",
      query: { model: modelId, messages, stream: true }
    })
    log.info("ai.call.opened", { path: "advanced", modelId, ms: since(startedAt) })
    return toTextDeltaStream(raw)
  } catch (err) {
    log.error("ai.call.error", {
      path: "advanced",
      modelId,
      ms: since(startedAt),
      error: err instanceof Error ? err.message : String(err)
    })
    throw err
  }
}

// Parse an SSE byte stream of {response|choices[].delta.content} chunks into a
// stream of plain text deltas.
function toTextDeltaStream(raw: ReadableStream): ReadableStream<Uint8Array> {
  const reader = raw.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buf = ""
  return new ReadableStream<Uint8Array>({
    // Loop until we enqueue at least one delta or the source is exhausted, so a
    // chunk carrying only keepalive / [DONE] lines doesn't leave the consumer's
    // pending read unresolved (some ReadableStream impls call pull once per read).
    async pull(controller) {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            controller.close()
            return
          }
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          let enqueued = false
          for (const line of lines) {
            const t = line.trim()
            if (!t.startsWith("data:")) continue
            const data = t.slice(5).trim()
            if (data === "[DONE]" || data === "") continue
            try {
              const obj = JSON.parse(data) as {
                response?: string
                choices?: Array<{ delta?: { content?: string } }>
              }
              const delta = obj.response ?? obj.choices?.[0]?.delta?.content ?? ""
              if (delta) {
                controller.enqueue(encoder.encode(delta))
                enqueued = true
              }
            } catch {
              /* ignore non-JSON keepalive lines */
            }
          }
          if (enqueued) return
        }
      } catch (err) {
        try {
          await reader.cancel()
        } catch {
          /* ignore */
        }
        controller.error(err)
      }
    },
    cancel() {
      void reader.cancel()
    }
  })
}

/** Drain a streamCompletion result into a single string (used by the DO + tests). */
export async function collectCompletion(
  env: Env,
  modelId: string,
  messages: ChatMsg[],
  advanced: boolean
): Promise<string> {
  const stream = await streamCompletion(env, modelId, messages, advanced)
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let out = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}
