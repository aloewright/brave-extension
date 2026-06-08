import type { Env } from "../env"

export interface McpServerCfg {
  name: string
  url: string
  transport: "http" | "sse"
  headers?: Record<string, string>
}

const key = (userId: string) => `mcp:servers:${userId}`

export function hindsightDefault(env: Env): McpServerCfg | null {
  if (!env.HINDSIGHT_URL) return null
  const headers: Record<string, string> = {}
  if (env.HINDSIGHT_BEARER) headers.Authorization = `Bearer ${env.HINDSIGHT_BEARER}`
  if (env.HINDSIGHT_ACCESS_CLIENT_ID) headers["CF-Access-Client-Id"] = env.HINDSIGHT_ACCESS_CLIENT_ID
  if (env.HINDSIGHT_ACCESS_CLIENT_SECRET) headers["CF-Access-Client-Secret"] = env.HINDSIGHT_ACCESS_CLIENT_SECRET
  return { name: "hindsight", url: env.HINDSIGHT_URL, transport: "http", headers }
}

export async function listMcpServers(env: Env, userId: string): Promise<McpServerCfg[]> {
  const raw = await env.AGENT_KV.get(key(userId))
  const user = raw ? (JSON.parse(raw) as McpServerCfg[]) : []
  const def = hindsightDefault(env)
  const names = new Set(user.map((s) => s.name))
  return def && !names.has(def.name) ? [def, ...user] : user
}

// NOTE: this read-modify-write is not atomic — KV has no compare-and-swap, so a
// concurrent put could clobber an interleaved edit. Acceptable here because
// MCP-server config edits are a low-frequency, single-user action.
export async function putMcpServer(env: Env, userId: string, cfg: McpServerCfg): Promise<void> {
  const raw = await env.AGENT_KV.get(key(userId))
  const user = raw ? (JSON.parse(raw) as McpServerCfg[]) : []
  const next = [...user.filter((s) => s.name !== cfg.name), cfg]
  await env.AGENT_KV.put(key(userId), JSON.stringify(next))
}

export async function removeMcpServer(env: Env, userId: string, name: string): Promise<void> {
  const raw = await env.AGENT_KV.get(key(userId))
  const user = raw ? (JSON.parse(raw) as McpServerCfg[]) : []
  await env.AGENT_KV.put(key(userId), JSON.stringify(user.filter((s) => s.name !== name)))
}
