import { Agent } from "agents"
import { chat } from "@tanstack/ai"
import type { Env } from "../env"
import { insertMessage, listMessages } from "../db"
import { resolveModel } from "../models"
import { streamCompletion, collectCompletion, type ChatMsg } from "../chat"
import { recallMemories, reflect } from "../memory"
import { log, since } from "../log"
import { envAiAdapter } from "../ai/env-ai-adapter"
import { buildCodeMode } from "../ai/code-mode"
import { buildToolRegistry } from "../tools/registry"
import { workerNativeSource } from "../tools/worker-native"
import { remoteMcpSource } from "../tools/remote-mcp"
import { listMcpServers } from "../tools/mcp-config"
import {
  BASE_SYSTEM_PROMPT,
  shouldUseCodeMode,
  translateEvent,
  type TraceEntry
} from "./code-mode-turn"

// Re-export the pure gate so callers/tests can import from chat-agent too.
export { shouldUseCodeMode } from "./code-mode-turn"

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
      userId?: string
      origin?: string
    }
    try {
      body = (await request.json()) as {
        sessionId?: string
        content?: string
        modelId?: string
        advanced?: boolean
        userId?: string
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
    // Image-generation models can't drive the text chat path. Reject early with
    // a clear error instead of streaming an empty/garbage reply.
    if (model.kind === "image") {
      log.warn("turn.rejected.image_model", { sessionId, modelId: model.id })
      return Response.json(
        { error: `Model ${model.id} generates images and isn't supported in chat.` },
        { status: 400 }
      )
    }
    const advanced = body.advanced === true && model.kind === "advanced"
    const turnStartedAt = Date.now()
    log.info("turn.start", {
      sessionId,
      modelId: model.id,
      advanced,
      stream: path === "/internal/turn/stream",
      contentChars: content.length
    })

    await insertMessage(this.env, {
      sessionId,
      role: "user",
      content,
      model: null
    })

    const history = await this.buildHistory(sessionId)

    const userId = body.userId?.trim() || "unknown"
    const memories =
      userId !== "unknown" ? await recallMemories(this.env, userId, content, 5) : []
    const contextMsgs: ChatMsg[] =
      memories.length > 0
        ? [
            {
              role: "system",
              content:
                "Relevant memories about this user:\n" +
                memories.map((m) => `- ${m.content}`).join("\n")
            }
          ]
        : []
    const fullHistory = [...contextMsgs, ...history]

    if (path === "/internal/turn") {
      const reply = await collectCompletion(this.env, model.id, fullHistory, advanced)
      const assistant = await insertMessage(this.env, {
        sessionId,
        role: "assistant",
        content: reply,
        model: model.id
      })
      this.setState({ sessionId, lastTurn: { user: content, assistant: reply } })
      log.info("turn.done", {
        sessionId,
        modelId: model.id,
        replyChars: reply.length,
        ms: since(turnStartedAt),
        stream: false
      })
      if (userId !== "unknown" && reply.trim()) {
        this.ctx.waitUntil(
          reflect(this.env, userId, sessionId, [
            { role: "user", content },
            { role: "assistant", content: reply }
          ]).catch((e) =>
            log.error("reflect.error", {
              sessionId,
              error: e instanceof Error ? e.message : String(e)
            })
          )
        )
      }
      return Response.json({ message: assistant })
    }

    // Streaming path: forward deltas as SSE while accumulating for persistence.
    const env = this.env
    const ctx = this.ctx
    const modelId = model.id
    const reflectUserId = userId
    const reflectContent = content

    // Build the tool registry up-front so we can decide between Code Mode and
    // plain chat. Sources: worker-native capabilities + the user's MCP servers.
    const sources = [
      workerNativeSource(env, userId),
      ...(await listMcpServers(env, userId)).map((s) => remoteMcpSource(s))
    ]
    const { tools } = await buildToolRegistry(sources)
    const origin = body.origin?.trim() || ""
    const useCM = Boolean(origin) && shouldUseCodeMode(model, tools.length)
    log.info("turn.codemode", {
      sessionId,
      modelId,
      tools: tools.length,
      used: useCM
    })

    let acc = ""
    const trace: TraceEntry[] = []

    // Each ReadableStream variant streams SSE frames, accumulates `acc`, persists
    // before [DONE], then schedules reflection. They differ only in the event
    // source: the Code Mode `chat()` loop vs the plain `streamCompletion` bytes.
    const finalize = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
      const enc = new TextEncoder()
      // CRITICAL: persist the assistant reply BEFORE signalling [DONE]/close.
      // Doing it after close raced the Durable Object's eviction and could
      // silently drop the reply — which is why conversations didn't hold.
      try {
        await insertMessage(env, {
          sessionId,
          role: "assistant",
          content: acc,
          model: modelId,
          toolTrace: trace.length > 0 ? JSON.stringify(trace) : null
        })
      } catch (e) {
        log.error("turn.stream.persist_failed", {
          sessionId,
          modelId,
          error: e instanceof Error ? e.message : String(e)
        })
      }

      controller.enqueue(enc.encode("data: [DONE]\n\n"))
      controller.close()

      log.info("turn.done", {
        sessionId,
        modelId,
        replyChars: acc.length,
        ms: since(turnStartedAt),
        stream: true,
        codeMode: useCM,
        empty: acc.trim().length === 0
      })

      if (reflectUserId !== "unknown" && acc.trim()) {
        ctx.waitUntil(
          reflect(env, reflectUserId, sessionId, [
            { role: "user", content: reflectContent },
            { role: "assistant", content: acc }
          ]).catch((e) =>
            log.error("reflect.error", {
              sessionId,
              error: e instanceof Error ? e.message : String(e)
            })
          )
        )
      }
    }

    if (useCM) {
      const { tool: cmTool, systemPrompt } = buildCodeMode(env, origin, tools)
      const sse = new ReadableStream<Uint8Array>({
        async start(controller) {
          const enc = new TextEncoder()
          const toolNames = new Map<string, string>()
          try {
            // chat() messages exclude `system` role — system entries (memory
            // context) flow through systemPrompts; the rest are user/assistant.
            const cmMessages = fullHistory
              .filter((m) => m.role !== "system")
              .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
            const cmSystemPrompts = [
              BASE_SYSTEM_PROMPT,
              systemPrompt,
              ...fullHistory.filter((m) => m.role === "system").map((m) => m.content)
            ]
            const events = chat({
              adapter: envAiAdapter(env, modelId),
              tools: [cmTool],
              systemPrompts: cmSystemPrompts,
              messages: cmMessages
            }) as AsyncIterable<{
              type: string
              delta?: string
              toolCallId?: string
              toolCallName?: string
            }>
            for await (const ev of events) {
              const r = translateEvent(ev, toolNames)
              for (const f of r.frames) controller.enqueue(enc.encode(f))
              if (r.appendText) acc += r.appendText
              if (r.trace.length) trace.push(...r.trace)
            }
          } catch (err) {
            log.error("turn.stream.error", {
              sessionId,
              modelId,
              codeMode: true,
              ms: since(turnStartedAt),
              error: err instanceof Error ? err.message : String(err)
            })
            controller.error(err)
            return
          }
          await finalize(controller)
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

    // Fallback: plain completion. Emit a one-shot notice only when the model
    // genuinely lacks tool support (not merely a missing origin).
    const noTooling = model.supportsTools !== true
    const source = await streamCompletion(this.env, model.id, fullHistory, advanced)
    const sse = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = source.getReader()
        const dec = new TextDecoder()
        const enc = new TextEncoder()
        if (noTooling) {
          controller.enqueue(
            enc.encode(
              `data: ${JSON.stringify({
                event: "notice",
                text: "Selected model has no tool support; using plain chat."
              })}\n\n`
            )
          )
        }
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            const text = dec.decode(value, { stream: true })
            acc += text
            controller.enqueue(enc.encode(`data: ${JSON.stringify({ delta: text })}\n\n`))
          }
        } catch (err) {
          reader.releaseLock()
          log.error("turn.stream.error", {
            sessionId,
            modelId,
            ms: since(turnStartedAt),
            error: err instanceof Error ? err.message : String(err)
          })
          controller.error(err)
          return
        }
        reader.releaseLock()

        // CRITICAL: persist the assistant reply BEFORE signalling [DONE]/close.
        // Doing it after close raced the Durable Object's eviction and could
        // silently drop the reply — which is why conversations didn't hold.
        // The response stream stays open until close(), keeping the DO alive
        // for this await.
        try {
          await insertMessage(env, {
            sessionId,
            role: "assistant",
            content: acc,
            model: modelId
          })
        } catch (e) {
          log.error("turn.stream.persist_failed", {
            sessionId,
            modelId,
            error: e instanceof Error ? e.message : String(e)
          })
        }

        controller.enqueue(enc.encode("data: [DONE]\n\n"))
        controller.close()

        log.info("turn.done", {
          sessionId,
          modelId,
          replyChars: acc.length,
          ms: since(turnStartedAt),
          stream: true,
          empty: acc.trim().length === 0
        })

        // Memory reflection is best-effort background work; waitUntil keeps the
        // DO alive without blocking the client's stream completion.
        if (reflectUserId !== "unknown" && acc.trim()) {
          ctx.waitUntil(
            reflect(env, reflectUserId, sessionId, [
              { role: "user", content: reflectContent },
              { role: "assistant", content: acc }
            ]).catch((e) =>
              log.error("reflect.error", {
                sessionId,
                error: e instanceof Error ? e.message : String(e)
              })
            )
          )
        }
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
