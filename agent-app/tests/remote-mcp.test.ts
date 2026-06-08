import { describe, expect, it, vi } from "vitest"
import { remoteMcpSource } from "../src/tools/remote-mcp"

function mcpFetch(tools: any[], onCall?: (name: string, args: any) => any) {
  return vi.fn(async (_url: string, init: any) => {
    const req = JSON.parse(init.body)
    const reply = (result: any) =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }), { headers: { "content-type": "application/json" } })
    if (req.method === "initialize") return reply({ capabilities: {} })
    if (req.method === "tools/list") return reply({ tools })
    if (req.method === "tools/call")
      return reply({ content: [{ type: "text", text: JSON.stringify(onCall?.(req.params.name, req.params.arguments) ?? {}) }] })
    return reply({})
  })
}

describe("remoteMcpSource", () => {
  it("lists tools and reports connected status", async () => {
    const f = mcpFetch([{ name: "echo", description: "echo", inputSchema: { type: "object", properties: { msg: { type: "string" } }, required: ["msg"] } }])
    const src = remoteMcpSource({ name: "ex", url: "https://x/mcp", transport: "http" }, f as any)
    const tools = await src.listTools()
    expect(tools[0]!.name).toBe("ex__echo")
    expect((await src.status()).state).toBe("connected")
  })
  it("proxies tools/call through .server()", async () => {
    const f = mcpFetch([{ name: "echo", description: "", inputSchema: { type: "object", properties: { msg: { type: "string" } } } }], (_n, args) => ({ said: args.msg }))
    const src = remoteMcpSource({ name: "ex", url: "https://x/mcp", transport: "http" }, f as any)
    const tool = (await src.listTools())[0]!
    const out = (await tool.server({ msg: "hi" })) as any
    expect(out.said).toBe("hi")
  })
  it("reports needs-auth on 401", async () => {
    const f = vi.fn(async () => new Response("no", { status: 401 }))
    const src = remoteMcpSource({ name: "ex", url: "https://x/mcp", transport: "http" }, f as any)
    expect((await src.status()).state).toBe("needs-auth")
  })
})
