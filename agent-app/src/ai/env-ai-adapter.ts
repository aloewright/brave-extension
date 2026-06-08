// Custom TanStack AI text adapter that routes every LLM call through the
// sanctioned Worker-side gateway path. Per ~/.claude/CLAUDE.md "Inside a
// Worker": a fetch() to the AI Gateway compat endpoint from inside a Worker is
// rejected (error 2019), and dynamic/* routes don't resolve via env.AI.run, so
// `env.AI.run(@cf/..., body, { gateway: { id: "x" } })` is the only working
// invocation. Swap back to dynamic routes when the binding/fetch path is fixed
// upstream.
//
// Interface verified against installed types:
//   @tanstack/ai@0.28.0
//     node_modules/@tanstack/ai/dist/esm/activities/chat/adapter.d.ts
//       BaseTextAdapter, TextOptions, StructuredOutput{Options,Result}
//     node_modules/@tanstack/ai/dist/esm/types.d.ts:1163  StreamChunk = AGUIEvent
//   @ag-ui/core@0.0.52  dist/index.d.ts  (EventType enum + event field names)
import { EventType, type StreamChunk, type TextOptions } from "@tanstack/ai"
import { BaseTextAdapter } from "@tanstack/ai/adapters"
import { AI_GATEWAY_ID, type Env } from "../env"
import { ulid } from "../ulid"

// Normalize TanStack `ModelMessage[]` into the OpenAI/Workers-AI chat schema
// (`{ role, content: <string> }` per message, with `tool_calls` / `tool_call_id`
// for tool round-trips). Workers AI's chat oneOf requires `content` to be a
// string, so on the SECOND agent-loop round — when options.messages contains an
// assistant message whose content is an ARRAY of content-parts (or null) plus a
// role:"tool" result message — passing options.messages straight through is
// rejected with error 5006. This maps every message to the string-content shape.
//
// Field names verified against @tanstack/ai types.d.ts:
//   ModelMessage { role: 'user'|'assistant'|'tool'; content: string|null|Array<ContentPart>;
//                  toolCalls?: ToolCall[]; toolCallId?: string }
//   ToolCall     { id; type:'function'; function:{ name; arguments: string } }
//   TextPart     { type:'text'; content: string }
function partsToText(content: unknown): string {
  if (typeof content === "string") return content
  if (content == null) return ""
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p
        if (p && typeof p === "object" && (p as any).type === "text") {
          return String((p as any).content ?? "")
        }
        return ""
      })
      .join("")
  }
  return ""
}

function stringifyArgs(args: unknown): string {
  if (typeof args === "string") return args
  if (args == null) return "{}"
  try {
    return JSON.stringify(args)
  } catch {
    return "{}"
  }
}

function stringifyResult(content: unknown): string {
  if (typeof content === "string") return content
  if (content == null) return ""
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

export function toWorkersAiMessages(messages: any[]): Array<Record<string, unknown>> {
  if (!Array.isArray(messages)) return []
  return messages.map((m) => {
    const role = m?.role

    if (role === "tool") {
      return {
        role: "tool",
        tool_call_id: m?.toolCallId ?? m?.tool_call_id ?? "",
        content: stringifyResult(m?.content ?? m?.result)
      }
    }

    if (role === "assistant" && Array.isArray(m?.toolCalls) && m.toolCalls.length > 0) {
      return {
        role: "assistant",
        content: partsToText(m?.content),
        tool_calls: m.toolCalls.map((tc: any) => ({
          id: tc?.id ?? "",
          type: "function",
          function: {
            name: tc?.function?.name ?? tc?.name ?? "",
            arguments: stringifyArgs(tc?.function?.arguments ?? tc?.arguments)
          }
        }))
      }
    }

    // system / user / assistant (text only)
    return { role: role ?? "user", content: partsToText(m?.content) }
  })
}

interface OpenAiToolDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}

interface SseChunk {
  response?: string
  choices?: Array<{
    delta?: { content?: string; tool_calls?: OpenAiToolDelta[] }
  }>
}

// Accumulator for a single tool call whose args arrive in fragments.
interface ToolAcc {
  id: string
  name: string
  started: boolean
}

class EnvAiTextAdapter extends BaseTextAdapter<
  string,
  Record<string, any>,
  ReadonlyArray<never>,
  any
> {
  readonly name = "env-ai"
  readonly #env: Env

  constructor(env: Env, model: string) {
    super(undefined, model)
    this.#env = env
  }

  async *chatStream(options: TextOptions<Record<string, any>>): AsyncIterable<StreamChunk> {
    const threadId = options.threadId ?? ulid()
    const runId = options.runId ?? ulid()

    yield { type: EventType.RUN_STARTED, threadId, runId } as StreamChunk

    const stream = await this.#run(options)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buf = ""

    let messageId: string | null = null
    // index -> accumulator. Index falls back to id when absent.
    const tools = new Map<string | number, ToolAcc>()

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split("\n")
        buf = lines.pop() ?? ""
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith("data:")) continue
          const data = t.slice(5).trim()
          if (data === "[DONE]" || data === "") continue
          let obj: SseChunk
          try {
            obj = JSON.parse(data) as SseChunk
          } catch {
            continue // keepalive / non-JSON
          }

          const delta = obj.response ?? obj.choices?.[0]?.delta?.content
          if (delta) {
            if (messageId === null) {
              messageId = ulid()
              yield {
                type: EventType.TEXT_MESSAGE_START,
                messageId,
                role: "assistant"
              } as StreamChunk
            }
            yield {
              type: EventType.TEXT_MESSAGE_CONTENT,
              messageId,
              delta
            } as StreamChunk
          }

          const toolCalls = obj.choices?.[0]?.delta?.tool_calls
          if (toolCalls) {
            for (const tc of toolCalls) {
              const key = tc.index ?? tc.id ?? 0
              let acc = tools.get(key)
              if (!acc) {
                acc = { id: tc.id ?? ulid(), name: tc.function?.name ?? "", started: false }
                tools.set(key, acc)
              }
              if (tc.id) acc.id = tc.id
              if (tc.function?.name) acc.name = tc.function.name
              if (!acc.started && acc.name) {
                acc.started = true
                yield {
                  type: EventType.TOOL_CALL_START,
                  toolCallId: acc.id,
                  toolCallName: acc.name
                } as StreamChunk
              }
              const argFrag = tc.function?.arguments
              if (argFrag) {
                yield {
                  type: EventType.TOOL_CALL_ARGS,
                  toolCallId: acc.id,
                  delta: argFrag
                } as StreamChunk
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock?.()
    }

    if (messageId !== null) {
      yield { type: EventType.TEXT_MESSAGE_END, messageId } as StreamChunk
    }
    let hadToolCalls = false
    for (const acc of tools.values()) {
      if (acc.started) {
        hadToolCalls = true
        yield { type: EventType.TOOL_CALL_END, toolCallId: acc.id } as StreamChunk
      }
    }

    // The chat() agent loop only executes pending tool calls when the finished
    // event reports finishReason === "tool_calls" (see @tanstack/ai chat
    // index.js). Without this, a Code Mode turn emits the execute_typescript
    // call but the loop never runs it and stops with an empty reply.
    const finishReason = hadToolCalls ? "tool_calls" : "stop"
    yield { type: EventType.RUN_FINISHED, threadId, runId, finishReason } as StreamChunk
  }

  // Minimal-but-correct structured output: drain a non-streaming run and return
  // the raw text. Validation against the schema happens in the activity layer
  // (the engine validates `data` itself), so we return the parsed JSON when we
  // can and the raw text either way.
  async structuredOutput(options: {
    chatOptions: TextOptions<Record<string, any>>
  }): Promise<{ data: unknown; rawText: string }> {
    const stream = await this.#run(options.chatOptions, false)
    const reader = stream.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    let rawText = ""
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split("\n")
      buf = lines.pop() ?? ""
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith("data:")) continue
        const data = t.slice(5).trim()
        if (data === "[DONE]" || data === "") continue
        try {
          const obj = JSON.parse(data) as SseChunk
          rawText += obj.response ?? obj.choices?.[0]?.delta?.content ?? ""
        } catch {
          /* keepalive */
        }
      }
    }
    let data: unknown = rawText
    try {
      data = JSON.parse(rawText)
    } catch {
      /* leave as raw text if not JSON */
    }
    return { data, rawText }
  }

  #run(options: TextOptions<Record<string, any>>, stream = true) {
    const body: Record<string, unknown> = {
      messages: toWorkersAiMessages(options.messages as any[]),
      stream
    }
    if (options.tools && options.tools.length > 0) {
      body.tools = options.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }))
    }
    // SANCTIONED Worker-side gateway invocation — see file header / CLAUDE.md.
    return this.#env.AI.run(this.model, body as any, {
      gateway: { id: AI_GATEWAY_ID }
    }) as unknown as Promise<ReadableStream<Uint8Array>>
  }
}

/** Create a TanStack AI text adapter bound to `env` and a Workers AI model id. */
export function envAiAdapter(env: Env, model: string): EnvAiTextAdapter {
  return new EnvAiTextAdapter(env, model)
}
