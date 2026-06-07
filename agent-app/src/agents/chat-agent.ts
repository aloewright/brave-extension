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
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 })
    }
    const body = (await request.json()) as { sessionId: string; content: string }
    if (!body?.sessionId || !body?.content) {
      return Response.json({ error: "sessionId and content required" }, { status: 400 })
    }

    await insertMessage(this.env, {
      sessionId: body.sessionId,
      role: "user",
      content: body.content,
      model: null
    })

    const reply = this.generateReply(body.content)
    const assistant = await insertMessage(this.env, {
      sessionId: body.sessionId,
      role: "assistant",
      content: reply,
      model: "echo"
    })

    this.setState({
      sessionId: body.sessionId,
      lastTurn: { user: body.content, assistant: reply }
    })

    return Response.json({ message: assistant })
  }

  // Plan 2 swaps this for an AI Gateway streamed completion.
  private generateReply(userContent: string): string {
    return `echo: ${userContent}`
  }
}
