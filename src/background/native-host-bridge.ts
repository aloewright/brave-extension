// src/background/native-host-bridge.ts
//
// Thin wrappers around chrome.runtime.sendNativeMessage for the two
// Foundation Models operations the chat needs ("chat" and "compact").
// The shaping helpers (buildSystemPrompt, toBridgeHistory) are exported
// so they're unit-testable directly.

import type {
  AmbientContext,
  ChatMessage,
  ToolDefinition
} from "./../lib/ai-chat-types"

const NATIVE_HOST_NAME = "ai_dev_host"

export interface BridgeRawResponse {
  ok: boolean
  available: boolean
  operation: string
  reason?: string
  error?: string
  chatTurn?: {
    final?: string
    toolCall?: { name: string; arguments: string }
  }
  compactSummary?: string
}

export interface BridgeHistoryRow {
  role: "user" | "assistant" | "tool"
  content: string
  toolName?: string
  toolArguments?: string
  toolError?: string
}

interface ChatBridgeInput {
  compactedHead: string
  history: ChatMessage[]
  tools: ToolDefinition[]
  ambient: AmbientContext
}

export async function runFoundationModelsChat(
  input: ChatBridgeInput,
  opts: { signal?: AbortSignal } = {}
): Promise<BridgeRawResponse> {
  const payload = {
    operation: "chat",
    systemPrompt: buildSystemPrompt(input.compactedHead, input.tools, input.ambient),
    history: input.history.map(toBridgeHistory),
    toolsJson: JSON.stringify(
      input.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parametersSchema: t.parametersSchema
      }))
    )
  }
  return await sendNativeMessage(payload, opts.signal)
}

export async function runFoundationModelsCompact(input: {
  compactSummary: string
}): Promise<{ compactSummary: string }> {
  const resp = await sendNativeMessage({
    operation: "compact",
    compactSummary: input.compactSummary
  })
  return { compactSummary: resp.compactSummary ?? "" }
}

export function buildSystemPrompt(
  compactedHead: string,
  tools: ToolDefinition[],
  ambient: AmbientContext
): string {
  const toolsCatalog = tools
    .map((t) => `- ${t.name}: ${t.description}`)
    .join("\n")

  const ambientLines: string[] = []
  if (ambient.activeTab?.url) {
    ambientLines.push(
      `Active tab: ${ambient.activeTab.title || "(untitled)"} — ${ambient.activeTab.url}`
    )
  }
  if (ambient.mostRecentClip) {
    ambientLines.push(
      `Most recent Joplin clip: "${ambient.mostRecentClip.title}" (${ambient.mostRecentClip.mode}) at ${ambient.mostRecentClip.createdAt}`
    )
  }
  const ambientBlock = ambientLines.length
    ? `CURRENT STATE:\n${ambientLines.join("\n")}`
    : ""
  const compactionBlock = compactedHead
    ? `EARLIER CONVERSATION (summary):\n${compactedHead}`
    : ""

  return [
    "You are an assistant inside a Brave sidebar extension. You can call tools to act on the user's Joplin notes and browser. When you have what you need to reply, use the `final` field. Otherwise use exactly one `toolCall`.",
    "AVAILABLE TOOLS:",
    toolsCatalog,
    ambientBlock,
    compactionBlock
  ]
    .filter((s) => s.length > 0)
    .join("\n\n")
}

export function toBridgeHistory(m: ChatMessage): BridgeHistoryRow {
  if (m.role === "assistant" && m.toolCall) {
    return {
      role: "assistant",
      content: "",
      toolName: m.toolCall.name,
      toolArguments: m.toolCall.argumentsRaw
    }
  }
  if (m.role === "tool") {
    return {
      role: "tool",
      content: m.content,
      toolName: m.toolCallId,
      toolError: m.toolError
    }
  }
  return {
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content
  }
}

async function sendNativeMessage(
  payload: unknown,
  signal?: AbortSignal
): Promise<BridgeRawResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"))
      return
    }
    chrome.runtime.sendNativeMessage(
      NATIVE_HOST_NAME,
      payload,
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        resolve(response as BridgeRawResponse)
      }
    )
    signal?.addEventListener("abort", () => reject(new Error("aborted")))
  })
}
