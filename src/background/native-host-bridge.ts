// src/background/native-host-bridge.ts
//
// Wrappers around a one-shot chrome.runtime.connectNative port for the two
// Foundation Models operations the chat needs ("chat" and "compact"). We use
// connectNative (not sendNativeMessage) because the host emits unrelated
// startup messages (MCP registration stderr) before processing requests, and
// the one-shot sendNativeMessage callback would resolve on the first message
// out of the host — which is the startup notice, not our response. With a
// port we filter incoming messages by `requestId` and resolve only on a
// match. The shaping helpers (buildSystemPrompt, toBridgeHistory) are
// exported so they're unit-testable directly.

import type {
  AmbientContext,
  ChatMessage,
  ToolDefinition
} from "./../lib/ai-chat-types"

const NATIVE_HOST_NAME = "com.aidev.sidebar"

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
  toolName?: string         // assistant tool-call rows: tool name (e.g. "joplin.ping")
  toolArguments?: string    // assistant tool-call rows: JSON-encoded args
  toolCallId?: string       // tool-result rows: ulid of the assistant tool-call this answers
  toolError?: string        // tool-result rows: error message if the call failed
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
  return await requestNative(
    {
      type: "foundationModels.chat",
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
    },
    opts.signal
  )
}

export async function runFoundationModelsCompact(input: {
  compactSummary: string
}): Promise<{ compactSummary: string }> {
  const resp = await requestNative({
    type: "foundationModels.compact",
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
  if (ambient.recentScrape) {
    ambientLines.push(
      [
        `Recent page scrape: ${ambient.recentScrape.title || "(untitled)"} — ${ambient.recentScrape.url}`,
        ambient.recentScrape.text.slice(0, 4_000)
      ].join("\n")
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
      toolCallId: m.toolCallId,
      toolError: m.toolError
    }
  }
  return {
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content
  }
}

let nextRequestId = 1
function makeRequestId(): string {
  return `fm-${Date.now().toString(36)}-${(nextRequestId++).toString(36)}`
}

async function requestNative(
  payload: { type: string; [k: string]: unknown },
  signal?: AbortSignal
): Promise<BridgeRawResponse> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("aborted"))
      return
    }
    const requestId = makeRequestId()
    let settled = false
    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    const cleanup = () => {
      settled = true
      if (signal) signal.removeEventListener("abort", onAbort)
      try { port.disconnect() } catch { /* already gone */ }
    }
    const onAbort = () => {
      if (settled) return
      cleanup()
      reject(new Error("aborted"))
    }
    if (signal) signal.addEventListener("abort", onAbort)

    port.onMessage.addListener((msg: { requestId?: string; type?: string } & Record<string, unknown>) => {
      if (settled) return
      // Filter for our response by requestId. The host emits unrelated
      // startup messages (mcp stderr, etc.) that we ignore.
      if (msg?.requestId !== requestId) return
      cleanup()
      resolve(msg as unknown as BridgeRawResponse)
    })
    port.onDisconnect.addListener(() => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener("abort", onAbort)
      const err = chrome.runtime.lastError?.message || "native host disconnected"
      reject(new Error(err))
    })

    try {
      port.postMessage({ ...payload, requestId })
    } catch (err) {
      cleanup()
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}
