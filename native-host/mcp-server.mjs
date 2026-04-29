/**
 * MCP server for AI Dev Sidebar — HTTP + SSE on 127.0.0.1.
 *
 * Implements the MCP "HTTP+SSE" transport: clients open GET /sse to receive
 * server-to-client messages, and POST /messages?sessionId=… to send their
 * JSON-RPC requests. Requests are matched to the open SSE stream by sessionId.
 *
 * This file owns:
 *   - Port selection (8473..8483)
 *   - Bearer-token auth (rotated on every host start)
 *   - Tool / resource registry (extension pushes state via setState/upsertResource)
 *   - JSON-RPC 2.0 dispatch for the MCP methods we support
 *   - ~/.claude.json auto-registration
 *
 * The MCP handshake we implement: initialize → initialized → list_tools /
 * list_resources / read_resource / call_tool / list_resource_templates.
 *
 * Spec scope (M3): server core, auth, registration, scaffold tool surface.
 * Tools wired up here are stubs; M4/M5 fill them in.
 */

import { createServer } from "http"
import { randomBytes } from "crypto"
import { writeFileSync, mkdirSync, readFileSync, existsSync, chmodSync } from "fs"
import { homedir } from "os"
import { join, dirname } from "path"
import { DOM_TOOL_DEFS, buildReferenceTools } from "./tool-defs/dom-tools.mjs"
import { LIBRARY_TOOL_DEFS } from "./tool-defs/library-tools.mjs"
import { CHROME_TOOL_DEFS } from "./tool-defs/chrome-tools.mjs"
import {
  RECORDER_BRIDGED_TOOL_DEFS,
  buildRecorderHostTools
} from "./tool-defs/recorder-tools.mjs"

const CONFIG_DIR = join(homedir(), ".config", "ai-dev-sidebar")
const TOKEN_PATH = join(CONFIG_DIR, "mcp-token")
const ENV_PATH = join(CONFIG_DIR, "env")
const CLAUDE_JSON = join(homedir(), ".claude.json")
const PORT_RANGE = [8473, 8474, 8475, 8476, 8477, 8478, 8479, 8480, 8481, 8482, 8483]

function nowIso() {
  return new Date().toISOString()
}

export class MCPServer {
  constructor({ logger } = {}) {
    this.log = logger || (() => {})
    this.token = null
    this.port = null
    this.httpServer = null
    this.sseClients = new Map() // sessionId -> { res, queue }
    this.resources = new Map() // uri -> { name, description, mimeType, payload }
    this.tools = new Map() // name -> { description, inputSchema, handler }
    this.toolRequestBridge = null // (name, args) => Promise<result> set by host

    this._registerBuiltinTools()
  }

  /**
   * Allow the host to delegate tool calls back through native messaging
   * (e.g. anything that requires chrome.* APIs in the background worker).
   */
  setToolRequestBridge(fn) {
    this.toolRequestBridge = fn
  }

  // ── Resource API used by the host/extension ────────────────────────────
  upsertResource(uri, def) {
    this.resources.set(uri, { uri, ...def })
    this._broadcast({
      jsonrpc: "2.0",
      method: "notifications/resources/list_changed"
    })
  }

  removeResource(uri) {
    if (this.resources.delete(uri)) {
      this._broadcast({
        jsonrpc: "2.0",
        method: "notifications/resources/list_changed"
      })
    }
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  async start() {
    this.token = randomBytes(32).toString("hex")
    mkdirSync(CONFIG_DIR, { recursive: true })
    writeFileSync(TOKEN_PATH, this.token, { mode: 0o600 })
    try {
      chmodSync(TOKEN_PATH, 0o600)
    } catch {
      /* best effort */
    }

    this.httpServer = createServer((req, res) => this._onRequest(req, res))

    for (const p of PORT_RANGE) {
      try {
        await new Promise((resolve, reject) => {
          const onError = (err) => {
            this.httpServer.removeListener("error", onError)
            reject(err)
          }
          this.httpServer.once("error", onError)
          this.httpServer.listen(p, "127.0.0.1", () => {
            this.httpServer.removeListener("error", onError)
            resolve()
          })
        })
        this.port = p
        break
      } catch (err) {
        if (err.code !== "EADDRINUSE") throw err
      }
    }

    if (!this.port) {
      throw new Error("MCP server: no free port in 8473..8483")
    }

    writeFileSync(
      ENV_PATH,
      `AI_DEV_MCP_URL=http://127.0.0.1:${this.port}\nAI_DEV_MCP_TOKEN=${this.token}\n`,
      { mode: 0o600 }
    )

    this._registerWithClaudeJson()
    this.log(`[mcp] listening on http://127.0.0.1:${this.port} (token rotated ${nowIso()})`)
  }

  stop() {
    for (const { res } of this.sseClients.values()) {
      try {
        res.end()
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear()
    this.httpServer?.close()
    this.httpServer = null
  }

  ptyEnv() {
    return {
      AI_DEV_MCP_URL: `http://127.0.0.1:${this.port}`,
      AI_DEV_MCP_TOKEN: this.token
    }
  }

  // ── Claude config registration ─────────────────────────────────────────
  _registerWithClaudeJson() {
    let cfg = {}
    if (existsSync(CLAUDE_JSON)) {
      try {
        cfg = JSON.parse(readFileSync(CLAUDE_JSON, "utf-8"))
      } catch (err) {
        this.log(`[mcp] WARN: cannot parse ${CLAUDE_JSON}: ${err.message}`)
        return
      }
    }
    cfg.mcpServers = cfg.mcpServers || {}
    // NOTE: the `${AI_DEV_MCP_TOKEN}` literal here is intentional — Claude
    // Code expands env-var references in `headers` at MCP-connection time
    // using the env it was launched with. Our PTY shells inherit
    // AI_DEV_MCP_TOKEN via mcpServer.ptyEnv(), so terminals spawned from the
    // sidepanel get expansion for free. External terminals only get the
    // expansion if the user runs `claude` from a shell that has the var
    // exported — that's what the M7 wrapper script (spec §7.1) covers.
    // Do NOT replace this with a baked-in token: that would write the secret
    // to disk in plaintext.
    cfg.mcpServers["ai-dev-sidebar"] = {
      type: "sse",
      url: `http://127.0.0.1:${this.port}/sse`,
      headers: { Authorization: "Bearer ${AI_DEV_MCP_TOKEN}" }
    }
    try {
      mkdirSync(dirname(CLAUDE_JSON), { recursive: true })
      writeFileSync(CLAUDE_JSON, JSON.stringify(cfg, null, 2))
      this.log(`[mcp] registered ai-dev-sidebar in ${CLAUDE_JSON}`)
    } catch (err) {
      this.log(`[mcp] WARN: cannot write ${CLAUDE_JSON}: ${err.message}`)
    }
  }

  // ── HTTP handling ──────────────────────────────────────────────────────
  _authOk(req) {
    const hdr = req.headers["authorization"] || ""
    const m = /^Bearer\s+(.+)$/.exec(hdr)
    return m && m[1] === this.token
  }

  _onRequest(req, res) {
    const url = new URL(req.url, `http://127.0.0.1:${this.port}`)

    if (!this._authOk(req)) {
      res.writeHead(401, {
        "content-type": "text/plain",
        "x-ai-dev-debug": "rotate-token-on-host-start"
      })
      res.end("unauthorized")
      return
    }

    if (url.pathname === "/sse" && req.method === "GET") {
      return this._handleSse(req, res)
    }
    if (url.pathname === "/messages" && req.method === "POST") {
      return this._handleMessage(req, res, url)
    }
    if (url.pathname === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ ok: true, port: this.port, sessions: this.sseClients.size }))
      return
    }

    res.writeHead(404)
    res.end()
  }

  _handleSse(req, res) {
    const sessionId = randomBytes(16).toString("hex")
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    })
    // First event tells the client where to POST.
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)

    this.sseClients.set(sessionId, { res })
    req.on("close", () => {
      this.sseClients.delete(sessionId)
    })
  }

  async _handleMessage(req, res, url) {
    const sessionId = url.searchParams.get("sessionId")
    const client = sessionId && this.sseClients.get(sessionId)
    if (!client) {
      res.writeHead(404)
      res.end("session not found")
      return
    }

    let body = ""
    req.setEncoding("utf-8")
    for await (const chunk of req) body += chunk
    let msg
    try {
      msg = JSON.parse(body)
    } catch {
      res.writeHead(400)
      res.end("bad json")
      return
    }

    res.writeHead(202)
    res.end()

    const reply = await this._dispatch(msg)
    if (reply) this._send(client, reply)
  }

  _send(client, msg) {
    try {
      client.res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)
    } catch (err) {
      this.log(`[mcp] sse write failed: ${err.message}`)
    }
  }

  _broadcast(msg) {
    for (const client of this.sseClients.values()) this._send(client, msg)
  }

  // ── JSON-RPC dispatch ──────────────────────────────────────────────────
  async _dispatch(msg) {
    const { id, method, params } = msg
    try {
      switch (method) {
        case "initialize":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: params?.protocolVersion || "2024-11-05",
              serverInfo: { name: "ai-dev-sidebar", version: "0.1.0" },
              capabilities: {
                tools: { listChanged: true },
                resources: { listChanged: true, subscribe: false }
              }
            }
          }
        case "notifications/initialized":
          return null
        case "tools/list":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: [...this.tools.values()].map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema
              }))
            }
          }
        case "tools/call": {
          const tool = this.tools.get(params?.name)
          if (!tool) {
            return { jsonrpc: "2.0", id, error: { code: -32602, message: `unknown tool ${params?.name}` } }
          }
          const result = await tool.handler(params.arguments || {})
          return {
            jsonrpc: "2.0",
            id,
            result: {
              content: Array.isArray(result?.content) ? result.content : [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
              isError: !!result?.isError
            }
          }
        }
        case "resources/list":
          return {
            jsonrpc: "2.0",
            id,
            result: {
              resources: [...this.resources.values()].map((r) => ({
                uri: r.uri,
                name: r.name,
                description: r.description,
                mimeType: r.mimeType || "application/json"
              }))
            }
          }
        case "resources/read": {
          const r = this.resources.get(params?.uri)
          if (!r) {
            return { jsonrpc: "2.0", id, error: { code: -32602, message: `no resource ${params?.uri}` } }
          }
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [
                {
                  uri: r.uri,
                  mimeType: r.mimeType || "application/json",
                  text: typeof r.payload === "string" ? r.payload : JSON.stringify(r.payload, null, 2)
                }
              ]
            }
          }
        }
        case "ping":
          return { jsonrpc: "2.0", id, result: {} }
        default:
          return { jsonrpc: "2.0", id, error: { code: -32601, message: `method ${method} not found` } }
      }
    } catch (err) {
      return { jsonrpc: "2.0", id, error: { code: -32000, message: err.message } }
    }
  }

  // ── Built-in tools ─────────────────────────────────────────────────────
  _registerBuiltinTools() {
    const echo = {
      name: "echo",
      description: "Echo a string back. Sanity check that the MCP server is reachable.",
      inputSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"]
      },
      handler: async ({ text }) => ({ content: [{ type: "text", text: String(text) }] })
    }
    this.tools.set(echo.name, echo)

    // Bridged tools — delegated to the extension's background worker via the
    // toolRequestBridge that the host wires up. M4/M5 register more.
    const tabsList = {
      name: "tabs_list",
      description: "List all open tabs in Brave with id, url, and title.",
      inputSchema: { type: "object", properties: {} },
      handler: async (args) => this._bridge("tabs_list", args)
    }
    this.tools.set(tabsList.name, tabsList)

    // DOM/interaction tools (M4, ALO-245). All bridged to the extension
    // background worker — schemas declared in tool-defs/dom-tools.mjs.
    for (const def of DOM_TOOL_DEFS) {
      const name = def.name
      this.tools.set(name, {
        name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: async (args) => this._bridge(name, args)
      })
    }

    // Reference tools (M4, ALO-245). Host-side; read/mutate the local
    // resources map directly with no extension round-trip.
    for (const def of buildReferenceTools(this)) {
      this.tools.set(def.name, def)
    }

    // Bookmarks + library tools (M5, ALO-246). All bridged.
    for (const def of LIBRARY_TOOL_DEFS) {
      const name = def.name
      this.tools.set(name, {
        name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: async (args) => this._bridge(name, args)
      })
    }

    // Cookies + extensions + Brave Search tools (M5, ALO-247). All bridged.
    for (const def of CHROME_TOOL_DEFS) {
      const name = def.name
      this.tools.set(name, {
        name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: async (args) => this._bridge(name, args)
      })
    }

    // Recorder tools (M6, ALO-249). Start/stop bridge to the SW; list/get
    // are host-side and read from the ai-dev://recordings resource.
    for (const def of RECORDER_BRIDGED_TOOL_DEFS) {
      const name = def.name
      this.tools.set(name, {
        name,
        description: def.description,
        inputSchema: def.inputSchema,
        handler: async (args) => this._bridge(name, args)
      })
    }
    for (const def of buildRecorderHostTools(this)) {
      this.tools.set(def.name, def)
    }
  }

  async _bridge(name, args) {
    if (!this.toolRequestBridge) {
      return { isError: true, content: [{ type: "text", text: `tool ${name} requires extension bridge; not connected.` }] }
    }
    return this.toolRequestBridge(name, args)
  }
}
