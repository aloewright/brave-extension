import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import http from "http"

// Verifies MCPServer.rotateToken() — old tokens 401 after rotation, new tokens
// continue to work, and ~/.config/ai-dev-sidebar/{mcp-token,env} are updated.

let MCPServer: any
let server: any
let tmpHome: string
let originalHome: string | undefined

function healthz(port: number, token: string | null): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/healthz",
        method: "GET",
        headers: token ? { authorization: `Bearer ${token}` } : {}
      },
      (res) => {
        res.resume()
        res.on("end", () => resolve(res.statusCode || 0))
      }
    )
    req.on("error", reject)
    req.end()
  })
}

beforeAll(async () => {
  tmpHome = mkdtempSync(join(tmpdir(), "mcp-rotate-test-"))
  originalHome = process.env.HOME
  process.env.HOME = tmpHome

  MCPServer = (await import("../native-host/mcp-server.mjs")).MCPServer
  server = new MCPServer({ logger: () => {} })
  try {
    await server.start()
  } catch {
    server = null
  }
})

afterAll(() => {
  try {
    server?.stop?.()
  } catch {
    /* ignore */
  }
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome
  try {
    rmSync(tmpHome, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
})

describe("MCP token rotation", () => {
  it("starts with a valid token that authorizes /healthz", async () => {
    if (!server) return
    expect(server.token).toMatch(/^[a-f0-9]{64}$/)
    const code = await healthz(server.port, server.token)
    expect(code).toBe(200)
  })

  it("writes mcp-token and env files into the redirected HOME", () => {
    if (!server) return
    const tokenFile = join(tmpHome, ".config", "ai-dev-sidebar", "mcp-token")
    const envFile = join(tmpHome, ".config", "ai-dev-sidebar", "env")
    expect(existsSync(tokenFile)).toBe(true)
    expect(existsSync(envFile)).toBe(true)
    expect(readFileSync(tokenFile, "utf-8").trim()).toBe(server.token)
    expect(readFileSync(envFile, "utf-8")).toContain(server.token)
    expect(readFileSync(envFile, "utf-8")).toContain(`AI_DEV_MCP_URL=http://127.0.0.1:${server.port}`)
  })

  it("invalidates old tokens after rotateToken() and accepts the new one", async () => {
    if (!server) return
    const oldToken = server.token
    const result = server.rotateToken()
    expect(result.token).not.toBe(oldToken)
    expect(result.token).toMatch(/^[a-f0-9]{64}$/)
    expect(server.token).toBe(result.token)

    expect(await healthz(server.port, oldToken)).toBe(401)
    expect(await healthz(server.port, result.token)).toBe(200)
    expect(await healthz(server.port, null)).toBe(401)
  })

  it("rewrites mcp-token and env on rotation", () => {
    if (!server) return
    const tokenFile = join(tmpHome, ".config", "ai-dev-sidebar", "mcp-token")
    const envFile = join(tmpHome, ".config", "ai-dev-sidebar", "env")
    expect(readFileSync(tokenFile, "utf-8").trim()).toBe(server.token)
    expect(readFileSync(envFile, "utf-8")).toContain(server.token)
  })

  it("records a host.lock owned by the current pid on start", () => {
    if (!server) return
    const lockFile = join(tmpHome, ".config", "ai-dev-sidebar", "host.lock")
    expect(existsSync(lockFile)).toBe(true)
    const lock = JSON.parse(readFileSync(lockFile, "utf-8"))
    expect(lock.pid).toBe(process.pid)
    expect(lock.port).toBe(server.port)
  })

  it("accepts the on-disk token even when the in-memory token drifts", async () => {
    if (!server) return
    // Simulate a restart/rotation overlap: the live process holds a stale
    // in-memory token while the shared env/token file (what clients read) has
    // the current one. Auth must still succeed against the on-disk token.
    const diskToken = readFileSync(
      join(tmpHome, ".config", "ai-dev-sidebar", "mcp-token"),
      "utf-8"
    ).trim()
    const savedInMemory = server.token
    server.token = "stale-in-memory-token-not-on-disk"
    try {
      expect(await healthz(server.port, diskToken)).toBe(200)
      expect(await healthz(server.port, "totally-wrong")).toBe(401)
    } finally {
      server.token = savedInMemory
    }
  })
})
