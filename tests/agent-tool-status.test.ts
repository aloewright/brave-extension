import { describe, expect, it, vi } from "vitest"
import { createAgentApiClient } from "../src/lib/agent-api"

describe("getToolStatus", () => {
  it("GETs /api/agent/tools/status with access headers", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sources: [{ id: "worker-native", status: { state: "connected", tools: 5 } }] }), { headers: { "content-type": "application/json" } })
    )
    vi.stubGlobal("fetch", fetchMock)
    const client = createAgentApiClient({ baseUrl: "https://agent.fly.pm", clientId: "id", clientSecret: "sec" })
    const sources = await client.getToolStatus()
    expect(sources[0]!.id).toBe("worker-native")
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/agent/tools/status"),
      expect.anything()
    )
    vi.unstubAllGlobals()
  })
})
