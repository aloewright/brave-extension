// src/lib/ai-chat-tools.ts
//
// V1 tool registry for the AI chat. Three tools wrapping existing
// joplin-client + chrome.tabs + the Joplin recents storage. The
// orchestrator imports buildTools(getToken) and runTool(tools, name, args).

import { Storage } from "@plasmohq/storage"
import { createNote, ping } from "./joplin-client"
import type {
  AmbientContext,
  ToolDefinition,
  ToolExecutionResult
} from "./ai-chat-types"

export function buildTools(
  getToken: () => Promise<string>
): ToolDefinition[] {
  return [
    {
      name: "joplin.createNote",
      description:
        "Create a new note in Joplin with the given title and body. Returns the new note's id.",
      parametersSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Note title." },
          body: { type: "string", description: "Markdown body of the note." },
          sourceUrl: {
            type: "string",
            description: "Optional source URL for the note."
          }
        },
        required: ["title", "body"],
        additionalProperties: false
      },
      async execute(args): Promise<ToolExecutionResult> {
        const token = await getToken()
        const title = String(args.title ?? "")
        const body = String(args.body ?? "")
        const sourceUrl =
          typeof args.sourceUrl === "string" ? args.sourceUrl : ""
        try {
          const id = await createNote({ title, body, sourceUrl }, token)
          return { ok: true, result: { id } }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          }
        }
      }
    },
    {
      name: "joplin.ping",
      description:
        "Check whether Joplin's Web Clipper service is reachable on localhost:41184. No arguments. Returns { reachable: boolean }.",
      parametersSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute(): Promise<ToolExecutionResult> {
        try {
          const reachable = await ping()
          return { ok: true, result: { reachable } }
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          }
        }
      }
    },
    {
      name: "context.activeTab",
      description:
        "Get the URL and title of the user's currently active browser tab. No arguments. Returns { url, title } or { url: null, title: null } if no active tab.",
      parametersSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute(): Promise<ToolExecutionResult> {
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true
        })
        const tab = tabs[0]
        if (!tab) return { ok: true, result: { url: null, title: null } }
        return {
          ok: true,
          result: { url: tab.url ?? null, title: tab.title ?? null }
        }
      }
    }
  ]
}

export async function runTool(
  tools: ToolDefinition[],
  name: string,
  argumentsJson: string
): Promise<ToolExecutionResult> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` }
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argumentsJson || "{}")
  } catch (err) {
    return {
      ok: false,
      error: `Tool '${name}' arguments did not parse as JSON: ${
        err instanceof Error ? err.message : String(err)
      }`
    }
  }
  return tool.execute(args)
}

export async function captureAmbient(): Promise<AmbientContext> {
  const ctx: AmbientContext = {}
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true
    })
    const tab = tabs[0]
    if (tab?.url) ctx.activeTab = { url: tab.url, title: tab.title ?? "" }
  } catch {
    /* swallow */
  }
  try {
    const storage = new Storage()
    const recents = await storage.get<{
      clips: Array<{
        title: string
        mode: string
        createdAt: string
        joplinUrl: string
      }>
    }>("ai-dev-joplin-recent-clips")
    const first = recents?.clips?.[0]
    if (first) {
      ctx.mostRecentClip = {
        title: first.title,
        mode: first.mode,
        createdAt: first.createdAt,
        joplinUrl: first.joplinUrl
      }
    }
  } catch {
    /* swallow */
  }
  return ctx
}
