import { Agent } from "agents"
import type { Env } from "../env"
import { insertMessage } from "../db"

export interface ChatAgentState {
  sessionId: string | null
  // Live mirror of the turn currently being assembled. Full history is the
  // D1 ledger; this is just hot working state for the Session API.
  lastTurn: { user: string; assistant: string } | null
}

/**
 * ChatAgent — one Durable Object instance per session (named by session id).
 * Plan 1 scope: persist the user message + an echoed assistant reply to D1 so
 * the full request → agent → D1 pipeline is real and testable. Plan 2 replaces
 * `generateReply` with a streamed AI Gateway completion + model selection.
 */
export class ChatAgent extends Agent<Env, ChatAgentState> {
  initialState: ChatAgentState = { sessionId: null, lastTurn: null }

  async onRequest(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== "/internal/turn") {
      return new Response("Not found", { status: 404 })
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }
    let body: { sessionId?: string; content?: string }
    try {
      body = (await request.json()) as { sessionId?: string; content?: string }
    } catch {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 })
    }
    if (!body?.sessionId || !body?.content) {
      return Response.json({ error: "sessionId and content required" }, { status: 400 })
    }
    const sessionId = body.sessionId!
    const content = body.content!

    await insertMessage(this.env, {
      sessionId,
      role: "user",
      content,
      model: null
    })

    const reply = this.generateReply(content)
    const assistant = await insertMessage(this.env, {
      sessionId,
      role: "assistant",
      content: reply,
      model: "echo"
    })

    this.setState({
      sessionId,
      lastTurn: { user: content, assistant: reply }
    })

    return Response.json({ message: assistant })
  }

  // Plan 2 swaps this for an AI Gateway streamed completion.
  private generateReply(userContent: string): string {
    return `echo: ${userContent}`
  }
}
