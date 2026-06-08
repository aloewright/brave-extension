import { Hono } from "hono"
import type { Env } from "../env"
import { workerNativeSource } from "../tools/worker-native"
import { remoteMcpSource } from "../tools/remote-mcp"
import { listMcpServers } from "../tools/mcp-config"
import { aggregateStatus } from "../tools/registry"

type Vars = { userId: string }
const agentTools = new Hono<{ Bindings: Env; Variables: Vars }>()

agentTools.get("/tools/status", async (c) => {
  const userId = c.get("userId")
  const servers = await listMcpServers(c.env, userId)
  const sources = [workerNativeSource(c.env, userId), ...servers.map((s) => remoteMcpSource(s))]
  return c.json({ sources: await aggregateStatus(sources) })
})

export default agentTools
