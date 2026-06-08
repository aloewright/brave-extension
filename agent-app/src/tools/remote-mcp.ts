// src/tools/remote-mcp.ts
import { z } from "zod"
import type { McpServerCfg } from "./mcp-config"
import type { ServerTool, ToolSource, ToolSourceStatus } from "./types"

/** Best-effort JSON-Schema → zod v4 converter for MCP tool inputSchemas. */
export function jsonSchemaToZod(s: any): z.ZodType<any> {
  if (!s || typeof s !== "object") return z.any()
  switch (s.type) {
    case "string":
      return z.string()
    case "number":
    case "integer":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      return z.array(s.items ? jsonSchemaToZod(s.items) : z.any())
    case "object": {
      const props = (s.properties ?? {}) as Record<string, any>
      const required = new Set<string>(Array.isArray(s.required) ? s.required : [])
      const shape: Record<string, z.ZodType<any>> = {}
      for (const [key, val] of Object.entries(props)) {
        const inner = jsonSchemaToZod(val)
        shape[key] = required.has(key) ? inner : inner.optional()
      }
      return z.object(shape)
    }
    default:
      return z.any()
  }
}

class AuthError extends Error {
  authError = true
}

/** An MCP client tool source over JSON-RPC 2.0 POSTed to cfg.url. */
export function remoteMcpSource(cfg: McpServerCfg, fetchFn: typeof fetch = fetch): ToolSource {
  let nextId = 1

  async function rpc(method: string, params: unknown): Promise<any> {
    const id = nextId++
    const res = await fetchFn(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...cfg.headers },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`mcp ${method} → ${res.status}`)
    }
    if (!res.ok) {
      throw new Error(`mcp ${method} → ${res.status}`)
    }
    const body = (await res.json()) as { error?: { message?: string }; result?: unknown }
    if (body.error) {
      throw new Error(body.error.message ?? `mcp ${method} error`)
    }
    return body.result
  }

  async function listTools(): Promise<ServerTool[]> {
    await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {} })
    const result = await rpc("tools/list", {})
    const tools = (result?.tools ?? []) as Array<{ name: string; description?: string; inputSchema?: any }>
    return tools.map((tool) => ({
      name: `${cfg.name}__${tool.name}`,
      description: tool.description ?? "",
      inputSchema: jsonSchemaToZod(tool.inputSchema),
      server: async (input: any) => {
        const callResult = (await rpc("tools/call", { name: tool.name, arguments: input })) as any
        const content = callResult?.content
        if (Array.isArray(content)) {
          const textPart = content.find((c: any) => c?.type === "text")
          if (textPart) {
            try {
              return JSON.parse(textPart.text)
            } catch {
              return { text: textPart.text }
            }
          }
        }
        return callResult
      },
    }))
  }

  async function status(): Promise<ToolSourceStatus> {
    try {
      const tools = await listTools()
      return { state: "connected", tools: tools.length }
    } catch (err: any) {
      const reason = err?.message ?? String(err)
      if (err?.authError) return { state: "needs-auth", reason }
      return { state: "failed", reason }
    }
  }

  return { id: `mcp:${cfg.name}`, listTools, status }
}
