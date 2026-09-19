import type {
  AmbientContext,
  ToolDefinition,
  ToolExecutionResult,
} from "./ai-chat-types";
import { ExtensionStorage } from "./extension-storage";
import type { ScrapeResult } from "../types";

const SCRAPES_KEY = "ai-dev-scrapes";

function scrapeKey(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("#")[0] || url;
  }
}

/** Tools exposed to the local AI chat after removing the note-service integration. */
export function buildTools(): ToolDefinition[] {
  return [
    {
      name: "context.activeTab",
      description:
        "Get the URL and title of the user's currently active browser tab. No arguments. Returns { url, title } or { url: null, title: null } if no active tab.",
      parametersSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(): Promise<ToolExecutionResult> {
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        const tab = tabs[0];
        if (!tab) return { ok: true, result: { url: null, title: null } };
        return {
          ok: true,
          result: { url: tab.url ?? null, title: tab.title ?? null },
        };
      },
    },
  ];
}

export async function runTool(
  tools: ToolDefinition[],
  name: string,
  argumentsJson: string,
): Promise<ToolExecutionResult> {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) return { ok: false, error: `Unknown tool: ${name}` };
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(argumentsJson || "{}");
  } catch (err) {
    return {
      ok: false,
      error: `Tool '${name}' arguments did not parse as JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
  return tool.execute(args);
}

export async function captureAmbient(): Promise<AmbientContext> {
  const ctx: AmbientContext = {};
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    const tab = tabs[0];
    if (tab?.url) ctx.activeTab = { url: tab.url, title: tab.title ?? "" };
  } catch {
    /* browser context is optional */
  }
  try {
    const storage = new ExtensionStorage();
    const activeUrl = ctx.activeTab?.url;
    const scrapes = await storage.get<ScrapeResult[]>(SCRAPES_KEY);
    const scrape = Array.isArray(scrapes)
      ? activeUrl
        ? scrapes.find((item) => scrapeKey(item.url) === scrapeKey(activeUrl))
        : scrapes[0]
      : null;
    if (scrape) {
      ctx.recentScrape = {
        url: scrape.url,
        title: scrape.title,
        text: scrape.text.slice(0, 6_000),
        timestamp: scrape.timestamp,
      };
    }
  } catch {
    /* scraped-page context is optional */
  }
  return ctx;
}
