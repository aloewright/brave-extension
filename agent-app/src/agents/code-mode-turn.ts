// Pure (cloudflare/agents-free) helpers for the Code Mode turn. Kept in a
// separate module so they can be unit-tested under plain vitest — importing
// chat-agent.ts pulls in the `agents` SDK which eagerly loads `cloudflare:`
// scheme modules that don't resolve under plain node/vitest.
import { EventType } from "@tanstack/ai"
import type { ModelEntry } from "../models"

/** System prompt prepended ahead of the Code Mode prompt for tool-using turns. */
export const BASE_SYSTEM_PROMPT =
  "You are a helpful assistant with access to tools via Code Mode."

/** Code Mode runs only on tool-capable models that actually have tools. */
export function shouldUseCodeMode(model: ModelEntry, toolCount: number): boolean {
  return model.supportsTools === true && toolCount > 0
}

/**
 * Pure gate for whether a streaming turn should attempt Code Mode. Combines the
 * request having an `origin` (needed to build the Code Mode sandbox), the model
 * supporting tools with tools actually available, and the code-exec token being
 * configured — without a token the driver can't authenticate, so we fall back
 * to plain chat rather than producing a broken stream.
 */
export function codeModeEnabled(args: {
  origin: boolean
  supportsTools: boolean
  toolCount: number
  hasToken: boolean
}): boolean {
  return (
    args.origin && args.supportsTools && args.toolCount > 0 && args.hasToken
  )
}

/** One entry in the persisted tool trace. */
export interface TraceEntry {
  toolCallId: string
  name: string
  status: "start" | "end"
}

/**
 * Result of translating a single AG-UI event into client/SSE + accumulation
 * effects. `frames` are ready-to-enqueue SSE payload strings; `appendText` is
 * appended to the assistant accumulator; `trace` entries are pushed to the
 * persisted tool trace; `finished` signals RUN_FINISHED.
 */
export interface TranslateResult {
  frames: string[]
  appendText: string
  trace: TraceEntry[]
  finished: boolean
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

/**
 * Pure translator: maps one AG-UI event to SSE frames + accumulation effects.
 * - TEXT_MESSAGE_CONTENT → {delta} frame + append delta to acc.
 * - TOOL_CALL_START → {event:"tool",status:"start"} frame + trace entry.
 * - TOOL_CALL_END → {event:"tool",status:"end"} frame + trace entry.
 * - RUN_FINISHED → finished=true.
 * Other events produce no client output.
 *
 * `toolNames` carries the toolCallId→name mapping seen at START so END (which
 * may omit the name) can resolve it.
 */
export function translateEvent(
  ev: { type: string; delta?: string; toolCallId?: string; toolCallName?: string },
  toolNames: Map<string, string>
): TranslateResult {
  const out: TranslateResult = { frames: [], appendText: "", trace: [], finished: false }
  switch (ev.type) {
    case EventType.TEXT_MESSAGE_CONTENT: {
      const delta = ev.delta ?? ""
      if (delta) {
        out.frames.push(sse({ delta }))
        out.appendText = delta
      }
      break
    }
    case EventType.TOOL_CALL_START: {
      const id = ev.toolCallId ?? ""
      const name = ev.toolCallName ?? "tool"
      if (id) toolNames.set(id, name)
      out.frames.push(sse({ event: "tool", name, status: "start" }))
      out.trace.push({ toolCallId: id, name, status: "start" })
      break
    }
    case EventType.TOOL_CALL_END: {
      const id = ev.toolCallId ?? ""
      const name = ev.toolCallName ?? toolNames.get(id) ?? "tool"
      out.frames.push(sse({ event: "tool", name, status: "end" }))
      out.trace.push({ toolCallId: id, name, status: "end" })
      break
    }
    case EventType.RUN_FINISHED:
      out.finished = true
      break
    default:
      break
  }
  return out
}
