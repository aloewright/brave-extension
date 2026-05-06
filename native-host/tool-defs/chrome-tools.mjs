/**
 * MCP tool definitions for cookies, extensions, and Brave Search (ALO-247, M5).
 *
 * Implementations live in:
 *   - src/background/cookies-tools.ts
 *   - src/background/extensions-tools.ts
 *   - src/background/search-tools.ts
 *
 * Cookies: gated behind chrome.storage.local["settings.cookies.allowAll"]
 *   (M7/ALO-250 will replace the gate with a per-call consent prompt).
 * extensions_uninstall: gated behind
 *   chrome.storage.local["settings.allowExtensionUninstall"].
 * brave_search: requires chrome.storage.local["settings.braveSearchApiKey"].
 */

export const COOKIES_TOOL_DEFS = [
  {
    name: "cookies_get",
    description:
      "Get cookies matching a URL, name, and/or domain. Wraps chrome.cookies.getAll. Sensitive — gated behind a consent setting.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        name: { type: "string" },
        domain: { type: "string" }
      }
    }
  },
  {
    name: "cookies_set",
    description:
      "Set a cookie via chrome.cookies.set. Sensitive — gated behind a consent setting.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        name: { type: "string" },
        value: { type: "string" },
        domain: { type: "string" },
        path: { type: "string" },
        secure: { type: "boolean" },
        httpOnly: { type: "boolean" },
        sameSite: {
          type: "string",
          enum: ["no_restriction", "lax", "strict", "unspecified"]
        },
        expirationDate: { type: "number" }
      },
      required: ["url", "name", "value"]
    }
  },
  {
    name: "cookies_remove",
    description:
      "Remove a single cookie by url + name. Sensitive — gated behind a consent setting.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        name: { type: "string" }
      },
      required: ["url", "name"]
    }
  },
  {
    name: "cookies_clear",
    description:
      "Remove all cookies matching a domain (or every cookie if domain omitted). Sensitive — gated behind a consent setting.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string" }
      }
    }
  }
]

export const EXTENSIONS_TOOL_DEFS = [
  {
    name: "extensions_list",
    description:
      "List installed Chrome extensions (id, name, enabled, type, version, description).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "extensions_set_enabled",
    description: "Enable or disable an installed extension by id.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        enabled: { type: "boolean" }
      },
      required: ["id", "enabled"]
    }
  },
  {
    name: "extensions_uninstall",
    description:
      "Uninstall an installed extension by id. **Disabled by default** — enable in Settings (Allow extension uninstall).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" }
      },
      required: ["id"]
    }
  },
  {
    name: "profiles_list",
    description:
      "List saved _lx Profiles ({id, name, extensionIds}).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "profiles_apply",
    description:
      "Apply a saved _lx Profile: enable the profile's extensions, disable the rest.",
    inputSchema: {
      type: "object",
      properties: {
        profileId: { type: "string" }
      },
      required: ["profileId"]
    }
  },
  {
    name: "groups_list",
    description:
      "List saved _lx Groups ({id, name, extensionIds, enabled}).",
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "groups_apply",
    description:
      "Apply a saved _lx Group: set its extensions to the group's enabled state.",
    inputSchema: {
      type: "object",
      properties: {
        groupId: { type: "string" }
      },
      required: ["groupId"]
    }
  }
]

export const SEARCH_TOOL_DEFS = [
  {
    name: "brave_search",
    description:
      "Search the web via the Brave Search API. Requires a user-configured API key in Settings.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        count: {
          type: "number",
          description: "Number of results (default 10, max 20)."
        }
      },
      required: ["query"]
    }
  }
]

export const CHROME_TOOL_DEFS = [
  ...COOKIES_TOOL_DEFS,
  ...EXTENSIONS_TOOL_DEFS,
  ...SEARCH_TOOL_DEFS
]
