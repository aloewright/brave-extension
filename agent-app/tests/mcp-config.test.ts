import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { listMcpServers, putMcpServer, hindsightDefault } from "../src/tools/mcp-config"

describe("mcp-config", () => {
  it("returns the Hindsight default when configured via env", async () => {
    const env = makeEnv()
    env.HINDSIGHT_URL = "https://hindsight.fly.pm/mcp"
    env.HINDSIGHT_BEARER = "tok"
    const def = hindsightDefault(env)
    expect(def?.name).toBe("hindsight")
    expect(def?.url).toContain("hindsight.fly.pm")
    expect(def?.headers?.Authorization).toBe("Bearer tok")
  })
  it("round-trips a user server in KV", async () => {
    const env = makeEnv()
    await putMcpServer(env, "user-1", { name: "ex", url: "https://x/mcp", transport: "http" })
    const list = await listMcpServers(env, "user-1")
    expect(list.find((s) => s.name === "ex")).toBeTruthy()
  })
})
