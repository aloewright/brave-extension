// src/tools/worker-native.ts
import { z } from "zod"
import type { Env } from "../env"
import { listSessions, getSession, listMessages } from "../db"
import { recallMemories, retainMemory } from "../memory"
import type { ServerTool, ToolSource, ToolSourceStatus } from "./types"

const MAX_BODY_BYTES = 256 * 1024

/**
 * Worker-native tool source: exposes the agent's own D1/Vectorize-backed
 * capabilities (memory, sessions, messages) plus a sandboxed web fetch as
 * Code Mode tools, scoped to a single user.
 */
export function workerNativeSource(env: Env, userId: string): ToolSource {
  const tools: ServerTool[] = [
    {
      name: "searchMemory",
      description: "Semantic search over the user's stored memories.",
      inputSchema: z.object({
        query: z.string(),
        k: z.number().int().min(1).max(20).default(5)
      }),
      async server(input: { query: string; k?: number }) {
        const k = input.k ?? 5
        return { memories: await recallMemories(env, userId, input.query, k) }
      }
    },
    {
      name: "rememberFact",
      description: "Persist a durable fact about the user for future recall.",
      inputSchema: z.object({ text: z.string().min(1) }),
      async server(input: { text: string }) {
        const row = await retainMemory(env, {
          userId,
          sessionId: null,
          kind: "fact",
          content: input.text
        })
        return { id: row.id }
      }
    },
    {
      name: "listSessions",
      description: "List the caller's chat sessions, most recent first.",
      inputSchema: z.object({}),
      async server() {
        return { sessions: await listSessions(env, userId) }
      }
    },
    {
      name: "getMessages",
      description: "Get the messages of one of the caller's sessions.",
      inputSchema: z.object({ sessionId: z.string() }),
      async server(input: { sessionId: string }) {
        const session = await getSession(env, userId, input.sessionId)
        if (!session) throw new Error("session not found or forbidden")
        return { messages: await listMessages(env, input.sessionId) }
      }
    },
    {
      name: "webFetch",
      description: "Fetch an http(s) URL and return its status and (capped) text body.",
      inputSchema: z.object({ url: z.string().url() }),
      async server(input: { url: string }) {
        const parsed = new URL(input.url)
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          throw new Error("only http(s) URLs are allowed")
        }
        const BLOCKED_HOST = /^(localhost|0\.0\.0\.0|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
        if (BLOCKED_HOST.test(parsed.hostname)) {
          throw new Error("internal/private addresses are not allowed")
        }
        const res = await fetch(input.url, { redirect: "follow" })
        const buf = new Uint8Array(await res.arrayBuffer())
        const capped = buf.subarray(0, MAX_BODY_BYTES)
        const body = new TextDecoder().decode(capped)
        return { status: res.status, body }
      }
    }
  ]

  return {
    id: "worker-native",
    async listTools() {
      return tools
    },
    async status(): Promise<ToolSourceStatus> {
      return { state: "connected", tools: tools.length }
    }
  }
}
