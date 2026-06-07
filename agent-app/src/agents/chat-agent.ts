import { Agent } from "agents"
import type { Env } from "../env"
import { insertMessage, listMessages } from "../db"
import { resolveModel } from "../models"
import { streamCompletion, collectCompletion, type ChatMsg } from "../chat"

export interface ChatAgentState {
  sessionId: string | null
  // Live mirror of the turn currently being assembled. Full history is the
  // D1 ledger; this is just hot working state for the Session API.
  lastTurn: { user: string; assistant: string } | null
}

/**
 * ChatAgent — one Durable Object instance per session (named by session id).
 * Persists the user message → builds history from D1 → completes through AI
 * Gateway "x" → persists the assistant text. `/internal/turn` returns JSON
 * (used by the non-stream route + tests); `/internal/turn/stream` returns an
 * SSE `text/event-stream`.
 */
export class ChatAgent extends Agent<Env, ChatAgentState> {
  initialState: ChatAgentState = { sessionId: null, lastTurn: null }

  async onRequest(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }
    if (path !== "/internal/turn" && path !== "/internal/turn/stream") {
      return new Response("Not found", { status: 404 })
    }

    let body: {
      sessionId?: string
      content?: string
      modelId?: string
      advanced?: boolean
    }
    try {
      body = (await request.json()) as {
        sessionId?: string
        content?: string
        modelId?: string
        advanced?: boolean
      }
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    if (!body?.sessionId || !body?.content) {
      return Response.json({ error: "sessionId and content required" }, { status: 400 })
    }

    const sessionId = body.sessionId
    const content = body.content

    const model = await resolveModel(this.env, body.modelId)
    const advanced = body.advanced === true && model.kind === "advanced"

    await insertMessage(this.env, {
      sessionId,
      role: "user",
      content,
      model: null
    })

    const history = await this.buildHistory(sessionId)

    if (path === "/internal/turn") {
      const reply = await collectCompletion(this.env, model.id, history, advanced)
      const assistant = await insertMessage(this.env, {
        sessionId,
        role: "assistant",
        content: reply,
        model: model.id
      })
      this.setState({ sessionId, lastTurn: { user: content, assistant: reply } })
      return Response.json({ message: assistant })
    }

    // Streaming path: forward deltas as SSE while accumulating for persistence.
    const source = await streamCompletion(this.env, model.id, history, advanced)
    const env = this.env
    const modelId = model.id
    let acc = ""
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = source.getReader()
        const dec = new TextDecoder()
        const enc = new TextEncoder()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const text = dec.decode(value, { stream: true })
          acc += text
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ delta: text })}\n\n`))
        }
        controller.enqueue(enc.encode("data: [DONE]\n\n"))
        controller.close()
        await insertMessage(env, {
          sessionId,
          role: "assistant",
          content: acc,
          model: modelId
        })
      }
    })
    return new Response(sse, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      }
    })
  }

  private async buildHistory(sessionId: string): Promise<ChatMsg[]> {
    const rows = await listMessages(this.env, sessionId)
    return rows.map((r) => ({
      role: (r.role === "assistant"
        ? "assistant"
        : r.role === "system"
          ? "system"
          : "user") as ChatMsg["role"],
      content: r.content
    }))
  }
}
