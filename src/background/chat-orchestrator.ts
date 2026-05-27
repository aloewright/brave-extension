// src/background/chat-orchestrator.ts
//
// The chat turn loop. One async function entry: runChatTurn({...}).
// Owns the cancellation map and the step cap. Side effects: storage
// writes via ai-chat-store, broadcasts via chrome.runtime.sendMessage.

import { ulid } from "../lib/ulid"
import { getSettings } from "../storage"
import {
  appendMessage,
  getConversation,
  setCompactedHead
} from "../lib/ai-chat-store"
import { buildTools, runTool } from "../lib/ai-chat-tools"
import {
  runFoundationModelsChat,
  runFoundationModelsCompact
} from "./native-host-bridge"
import type {
  AmbientContext,
  ChatMessage,
  ChatTurnDoneEvent,
  ChatTurnUpdateEvent
} from "../lib/ai-chat-types"

const STEP_CAP = 10
const COMPACT_TRIGGER = 40

const cancelledTurns = new Set<string>()
const activeTurns = new Map<string, AbortController>()

function broadcast(event: ChatTurnUpdateEvent | ChatTurnDoneEvent): void {
  try {
    void chrome.runtime.sendMessage(event)
  } catch {
    /* no listeners — fine */
  }
}

export function stopTurn(turnId: string): void {
  cancelledTurns.add(turnId)
  activeTurns.get(turnId)?.abort()
}

interface RunChatTurnInput {
  userMessageId: string
  text: string
  ambient: AmbientContext
}

export async function runChatTurn(input: RunChatTurnInput): Promise<void> {
  const turnId = ulid()
  const controller = new AbortController()
  activeTurns.set(turnId, controller)

  try {
    // 1. Persist + broadcast the user message.
    const userMsg: ChatMessage = {
      id: input.userMessageId,
      role: "user",
      content: input.text,
      ambient: input.ambient,
      turnId,
      createdAt: new Date().toISOString()
    }
    await appendMessage(userMsg)
    broadcast({ type: "ai-chat/turn-update", turnId, appendedMessage: userMsg })

    // 2. Resolve tools and token.
    const settings = await getSettings()
    const tools = buildTools(async () => settings.joplinToken ?? "")

    // 3. Loop.
    let steps = 0
    while (steps < STEP_CAP) {
      if (cancelledTurns.has(turnId)) {
        await emitStopped(turnId)
        return
      }

      const conv = await getConversation()
      const compactedHead = conv.compactedHead?.summary ?? ""
      const history = trimToCompactionPoint(
        conv.messages,
        conv.compactedHead?.truncatedThrough
      )

      let bridgeResp
      try {
        bridgeResp = await runFoundationModelsChat(
          { compactedHead, history, tools, ambient: input.ambient },
          { signal: controller.signal }
        )
      } catch (err) {
        await emitError(turnId, err instanceof Error ? err.message : String(err))
        return
      }

      if (cancelledTurns.has(turnId)) {
        await emitStopped(turnId)
        return
      }

      const turn = bridgeResp.chatTurn
      if (!turn) {
        await emitError(turnId, "Bridge returned no chatTurn payload.")
        return
      }

      // Both fields present → prefer toolCall, continue loop.
      if (turn.toolCall) {
        const callId = ulid()
        const assistantMsg: ChatMessage = {
          id: ulid(),
          role: "assistant",
          content: "",
          toolCall: {
            id: callId,
            name: turn.toolCall.name,
            arguments: safeParseObject(turn.toolCall.arguments),
            argumentsRaw: turn.toolCall.arguments
          },
          turnId,
          createdAt: new Date().toISOString()
        }
        await appendMessage(assistantMsg)
        broadcast({
          type: "ai-chat/turn-update",
          turnId,
          appendedMessage: assistantMsg
        })

        const result = await runTool(
          tools,
          turn.toolCall.name,
          turn.toolCall.arguments
        )
        const toolMsg: ChatMessage = {
          id: ulid(),
          role: "tool",
          content: JSON.stringify(result.result ?? result.error ?? null),
          toolCallId: callId,
          toolError: result.ok ? undefined : result.error,
          turnId,
          createdAt: new Date().toISOString()
        }
        await appendMessage(toolMsg)
        broadcast({
          type: "ai-chat/turn-update",
          turnId,
          appendedMessage: toolMsg
        })
        steps += 1
        continue
      }

      if (turn.final !== undefined) {
        const assistantMsg: ChatMessage = {
          id: ulid(),
          role: "assistant",
          content: turn.final,
          turnId,
          createdAt: new Date().toISOString()
        }
        await appendMessage(assistantMsg)
        broadcast({
          type: "ai-chat/turn-update",
          turnId,
          appendedMessage: assistantMsg
        })
        broadcast({ type: "ai-chat/turn-done", turnId, reason: "final" })
        return
      }

      // Defensive: neither field present.
      await emitError(turnId, "Bridge returned chatTurn with neither final nor toolCall.")
      return
    }

    // 4. Step cap.
    const capMsg: ChatMessage = {
      id: ulid(),
      role: "assistant",
      content: `Hit the ${STEP_CAP}-step cap. Send another message to continue.`,
      turnId,
      createdAt: new Date().toISOString()
    }
    await appendMessage(capMsg)
    broadcast({ type: "ai-chat/turn-update", turnId, appendedMessage: capMsg })
    broadcast({ type: "ai-chat/turn-done", turnId, reason: "step-cap" })
  } catch (err) {
    await emitError(turnId, err instanceof Error ? err.message : String(err))
  } finally {
    activeTurns.delete(turnId)
    cancelledTurns.delete(turnId)
    void maybeCompact()
  }
}

async function emitStopped(turnId: string): Promise<void> {
  const msg: ChatMessage = {
    id: ulid(),
    role: "assistant",
    content: "Stopped by user.",
    turnId,
    createdAt: new Date().toISOString()
  }
  await appendMessage(msg)
  broadcast({ type: "ai-chat/turn-update", turnId, appendedMessage: msg })
  broadcast({ type: "ai-chat/turn-done", turnId, reason: "stopped" })
}

async function emitError(turnId: string, errorMessage: string): Promise<void> {
  broadcast({ type: "ai-chat/turn-done", turnId, reason: "error", errorMessage })
}

function safeParseObject(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || "{}")
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function trimToCompactionPoint(
  messages: ChatMessage[],
  truncatedThrough: string | undefined
): ChatMessage[] {
  if (!truncatedThrough) return messages
  const idx = messages.findIndex((m) => m.id === truncatedThrough)
  if (idx < 0) return messages
  return messages.slice(idx + 1)
}

async function maybeCompact(): Promise<void> {
  const conv = await getConversation()
  const headId = conv.compactedHead?.truncatedThrough
  let sinceHead = conv.messages
  if (headId) {
    const i = conv.messages.findIndex((m) => m.id === headId)
    if (i >= 0) sinceHead = conv.messages.slice(i + 1)
  }
  if (sinceHead.length < COMPACT_TRIGGER) return

  const oldestHalf = sinceHead.slice(0, Math.floor(sinceHead.length / 2))
  if (oldestHalf.length === 0) return
  const text = oldestHalf
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(0, 6000)
  try {
    const r = await runFoundationModelsCompact({ compactSummary: text })
    if (r.compactSummary) {
      const lastId = oldestHalf[oldestHalf.length - 1].id
      await setCompactedHead(r.compactSummary, lastId)
    }
  } catch {
    /* swallow — best-effort */
  }
}
