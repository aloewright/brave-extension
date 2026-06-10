// src/lib/ai-chat-tools.ts
//
// V1 tool registry for the AI chat. Ten tools total: nine joplin.*
// tools (wrapping src/lib/joplin) plus context.activeTab. Destructive
// operations (delete*, removeTagFromNote) are intentionally library-
// only — exported from the joplin barrel but not registered as tools.
// The orchestrator imports buildTools(getToken) and runTool(tools,
// name, args).

import { Storage } from "@plasmohq/storage"
import {
  createNote,
  ping,
  getNote,
  appendToNote,
  searchNotes,
  listFolders,
  listTags,
  findOrCreateFolder,
  addTagToNoteByName
} from "./joplin"
import type {
  AmbientContext,
  ToolDefinition,
  ToolExecutionResult
} from "./ai-chat-types"
import type { ScrapeResult } from "../types"

const SCRAPES_KEY = "ai-dev-scrapes"

function scrapeKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ""
    return parsed.toString()
  } catch {
    return url.split("#")[0] || url
  }
}

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
      name: "joplin.getNote",
      description:
        "Get a Joplin note by id. Returns { id, title, body, parent_id, updated_time }. Defaults to a useful field set if not specified.",
      parametersSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Joplin note id (32-char hex)." }
        },
        required: ["id"],
        additionalProperties: false
      },
      async execute(args): Promise<ToolExecutionResult> {
        const token = await getToken()
        const id = String(args.id ?? "")
        try {
          const note = await getNote(id, ["id", "title", "body", "parent_id", "updated_time"], token)
          return { ok: true, result: note }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
    },
    {
      name: "joplin.appendToNote",
      description:
        "Append Markdown text to an existing Joplin note's body. Reads, concatenates with a paragraph separator if needed, writes back. Returns { id }.",
      parametersSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string", description: "Markdown to append." }
        },
        required: ["id", "text"],
        additionalProperties: false
      },
      async execute(args): Promise<ToolExecutionResult> {
        const token = await getToken()
        const id = String(args.id ?? "")
        const text = String(args.text ?? "")
        try {
          await appendToNote(id, text, token)
          return { ok: true, result: { id } }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
    },
    {
      name: "joplin.searchNotes",
      description:
        "Full-text search across the user's Joplin notes. Returns the top 20 matches by recency. Each match has { id, title, parent_id, updated_time }. Sets truncated: true if Joplin has more results.",
      parametersSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Joplin search query. Supports their query DSL (tag:, notebook:, etc.); plain text matches title + body."
          }
        },
        required: ["query"],
        additionalProperties: false
      },
      async execute(args): Promise<ToolExecutionResult> {
        const token = await getToken()
        const query = String(args.query ?? "")
        try {
          const result = await searchNotes(query, { cap: 20 }, token)
          return { ok: true, result }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
    },
    {
      name: "joplin.listFolders",
      description:
        "List the user's Joplin notebooks (folders). Returns { items: [{id, title, parent_id}], truncated }.",
      parametersSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute(): Promise<ToolExecutionResult> {
        const token = await getToken()
        try {
          const result = await listFolders(token)
          return { ok: true, result }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
    },
    {
      name: "joplin.listTags",
      description:
        "List the user's Joplin tags. Returns { items: [{id, title}], truncated }.",
      parametersSchema: {
        type: "object",
        properties: {},
        additionalProperties: false
      },
      async execute(): Promise<ToolExecutionResult> {
        const token = await getToken()
        try {
          const result = await listTags(token)
          return { ok: true, result }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
    },
    {
      name: "joplin.findOrCreateFolder",
      description:
        "Find a Joplin notebook by title (optionally under a parent notebook), creating it if it doesn't exist. Title match is case-sensitive. Returns { id }.",
      parametersSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          parentId: {
            type: "string",
            description: "Optional parent notebook id. Omit for top-level."
          }
        },
        required: ["title"],
        additionalProperties: false
      },
      async execute(args): Promise<ToolExecutionResult> {
        const token = await getToken()
        const title = String(args.title ?? "")
        const parentId = typeof args.parentId === "string" ? args.parentId : undefined
        try {
          const id = await findOrCreateFolder(title, parentId, token)
          return { ok: true, result: { id } }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
        }
      }
    },
    {
      name: "joplin.addTagToNoteByName",
      description:
        "Apply a tag to a Joplin note by tag name. Creates the tag if it doesn't exist (Joplin tags are case-insensitive; stored lowercased). Returns { ok: true }.",
      parametersSchema: {
        type: "object",
        properties: {
          noteId: { type: "string" },
          tagName: { type: "string" }
        },
        required: ["noteId", "tagName"],
        additionalProperties: false
      },
      async execute(args): Promise<ToolExecutionResult> {
        const token = await getToken()
        const noteId = String(args.noteId ?? "")
        const tagName = String(args.tagName ?? "")
        try {
          await addTagToNoteByName(noteId, tagName, token)
          return { ok: true, result: { ok: true } }
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) }
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
    const activeUrl = ctx.activeTab?.url
    const scrapes = await storage.get<ScrapeResult[]>(SCRAPES_KEY)
    const scrape = Array.isArray(scrapes)
      ? activeUrl
        ? scrapes.find((item) => scrapeKey(item.url) === scrapeKey(activeUrl))
        : scrapes[0]
      : null
    if (scrape) {
      ctx.recentScrape = {
        url: scrape.url,
        title: scrape.title,
        text: scrape.text.slice(0, 6_000),
        timestamp: scrape.timestamp
      }
    }
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
