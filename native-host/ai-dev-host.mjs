#!/usr/bin/env node
/**
 * Native Messaging Host for AI Dev Sidebar
 * Bridges the browser extension to local CLI tools (claude, gemini, copilot, codex).
 *
 * Persistent context is achieved per-backend using each CLI's native session continuation:
 *   - claude:  first call: `claude -p "prompt"` | subsequent: `claude -p --continue "prompt"`
 *   - gemini:  first call: `gemini -p "prompt"` | subsequent: `gemini -p --resume latest "prompt"`
 *   - codex:   first call: `codex exec "prompt"` | subsequent: `codex exec resume --last "prompt"`
 *   - copilot: stateless (`gh copilot suggest` has no session support)
 *
 * The "reset-backend" message clears the hasSession flag so the next exec starts fresh.
 */

import { spawn } from "child_process"
import { readFileSync, existsSync } from "fs"
import { homedir } from "os"
import { join } from "path"

/** Tracks whether each backend has an active session to continue */
const hasSession = {
  claude: false,
  gemini: false,
  codex: false,
  copilot: false // always false — no session support
}

/** Active child processes (by pid) for kill support */
const activeProcesses = new Map()

function sendMessage(msg) {
  const json = JSON.stringify(msg)
  const buf = Buffer.alloc(4)
  buf.writeUInt32LE(json.length, 0)
  process.stdout.write(buf)
  process.stdout.write(json)
}

// ─── Framed stdin reader ───────────────────────────────────────────────
// Chrome native messaging uses a 4-byte LE length prefix followed by a JSON
// body. A single stdin chunk may contain partial frames, multiple frames,
// or frames split across the 4-byte header boundary. We keep a persistent
// accumulator buffer across chunks and a queue of parsed-but-unread messages
// so `readMessage()` is always correct regardless of how the OS pipe slices
// the data.

let stdinBuffer = Buffer.alloc(0)
const pendingMessages = []
const pendingReaders = []
let stdinListenerAttached = false

function ensureStdinListener() {
  if (stdinListenerAttached) return
  stdinListenerAttached = true
  process.stdin.on("data", (chunk) => {
    stdinBuffer = stdinBuffer.length === 0 ? chunk : Buffer.concat([stdinBuffer, chunk])
    // Drain as many complete frames as the buffer holds
    while (stdinBuffer.length >= 4) {
      const len = stdinBuffer.readUInt32LE(0)
      if (stdinBuffer.length < 4 + len) break
      const body = stdinBuffer.slice(4, 4 + len).toString("utf8")
      stdinBuffer = stdinBuffer.slice(4 + len)
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch (err) {
        sendMessage({ type: "error", data: `Invalid JSON frame: ${err.message}` })
        continue
      }
      if (pendingReaders.length > 0) {
        pendingReaders.shift()(parsed)
      } else {
        pendingMessages.push(parsed)
      }
    }
  })
  // If stdin closes, the extension disconnected — exit gracefully.
  process.stdin.on("end", () => process.exit(0))
}

function readMessage() {
  ensureStdinListener()
  if (pendingMessages.length > 0) {
    return Promise.resolve(pendingMessages.shift())
  }
  return new Promise((resolve) => pendingReaders.push(resolve))
}

function getClaudeConfig(configPath = "~/.claude.json") {
  const resolved = configPath.replace("~", homedir())
  const paths = [
    resolved,
    join(homedir(), ".claude.json"),
    join(homedir(), ".claude", "settings.json"),
    join(homedir(), ".config", "claude", "settings.json")
  ]
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"))
      } catch { continue }
    }
  }
  return null
}

function getMCPServers(configPath) {
  const config = getClaudeConfig(configPath)
  if (!config) return []
  const servers = config.mcpServers || config.mcp_servers || {}
  return Object.entries(servers).map(([name, conf]) => {
    const type = conf.type || (conf.url ? "http" : "stdio")
    return {
      name,
      type,
      command: conf.command,
      args: conf.args || [],
      env: conf.env || {},
      url: conf.url,
      headers: conf.headers || {},
      source: "user-config"
    }
  })
}

/**
 * Run `claude mcp list` and parse its output. This shows ALL connected servers
 * regardless of source — claude.ai integrations, plugin servers, user config,
 * project config — with their live connection status.
 *
 * Returns a Promise of MCPServer[].
 */
function listAllMCPServers() {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["mcp", "list"], {
      shell: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NO_COLOR: "1" }
    })
    proc.stdin.end()

    let stdout = ""
    let stderr = ""
    proc.stdout.on("data", (d) => { stdout += d.toString() })
    proc.stderr.on("data", (d) => { stderr += d.toString() })

    proc.on("close", () => {
      const servers = parseMCPList(stdout)
      // Merge in any user-config servers not in the CLI output (edge case)
      const fromConfig = getMCPServers()
      for (const cfg of fromConfig) {
        if (!servers.find((s) => s.name === cfg.name)) {
          servers.push({ ...cfg, status: "unknown" })
        }
      }
      resolve(servers)
    })

    proc.on("error", () => {
      resolve(getMCPServers().map((s) => ({ ...s, status: "unknown" })))
    })
  })
}

/**
 * Parse `claude mcp list` text output into structured MCPServer objects.
 *
 * Sample lines:
 *   "claude.ai Exa: https://mcp.exa.ai/mcp - ✓ Connected"
 *   "Sanity: https://mcp.sanity.io (HTTP) - ✓ Connected"
 *   "context7: https://mcp.context7.com/mcp (HTTP) - ✓ Connected"
 *   "claude-flow: npx -y @claude-flow/cli@latest mcp start - ✓ Connected"
 *   "plugin:github:github: https://api.githubcopilot.com/mcp/ (HTTP) - ✗ Failed to connect"
 */
function parseMCPList(text) {
  const lines = text.split("\n")
  const servers = []

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith("Checking ")) continue

    // Find the last " - " — that's the separator before status.
    // (Names and URLs can contain ":" and "-", so split from the right.)
    const sepIdx = line.lastIndexOf(" - ")
    if (sepIdx === -1) continue
    const left = line.slice(0, sepIdx).trim()
    const statusRaw = line.slice(sepIdx + 3).trim()

    // Split name from "command-or-url" on the FIRST ": " — names like
    // "claude.ai Exa" or "plugin:github:github" come before the URL.
    // Plugin names contain ":" but always have a ": " before the URL portion.
    const colonIdx = left.search(/:\s+(?=https?:\/\/|npx |node |python |\/|[a-zA-Z]:[\\\/])/)
    let name, target
    if (colonIdx !== -1) {
      name = left.slice(0, colonIdx).trim()
      target = left.slice(colonIdx + 1).trim()
    } else {
      // Fallback: split on first ": "
      const idx = left.indexOf(": ")
      if (idx === -1) continue
      name = left.slice(0, idx).trim()
      target = left.slice(idx + 2).trim()
    }

    // Extract optional "(TYPE)" suffix
    let type = "stdio"
    const typeMatch = target.match(/\s*\((HTTP|SSE|STDIO)\)\s*$/i)
    if (typeMatch) {
      type = typeMatch[1].toLowerCase()
      target = target.slice(0, typeMatch.index).trim()
    } else if (/^https?:\/\//.test(target)) {
      type = "http"
    }

    // Normalize status
    let status = "unknown"
    const cleanStatus = statusRaw.replace(/[✓✗!]\s*/g, "").trim().toLowerCase()
    if (cleanStatus.startsWith("connected")) status = "connected"
    else if (cleanStatus.startsWith("failed")) status = "failed"
    else if (cleanStatus.startsWith("needs auth")) status = "needs-auth"
    else if (cleanStatus.startsWith("authenticat")) status = "needs-auth"
    else if (cleanStatus.includes("disconnect")) status = "disconnected"

    // Determine source from name pattern
    let source = "user-config"
    if (name.startsWith("claude.ai ")) source = "claude-ai"
    else if (name.startsWith("plugin:")) source = "plugin"

    const server = {
      name,
      type,
      status,
      source
    }
    if (type === "http" || type === "sse") {
      server.url = target
    } else {
      // Parse "cmd arg1 arg2" into command + args
      const parts = target.split(/\s+/)
      server.command = parts[0]
      server.args = parts.slice(1)
    }
    servers.push(server)
  }

  return servers
}

/**
 * Build the command + args for a backend, using session continuation if available.
 */
function resolveBackendCommand(backend, prompt) {
  switch (backend) {
    case "claude": {
      const args = ["-p"]
      if (hasSession.claude) args.push("--continue")
      args.push(prompt)
      return { cmd: "claude", args }
    }
    case "gemini": {
      const args = ["-p"]
      if (hasSession.gemini) args.push("--resume", "latest")
      args.push(prompt)
      return { cmd: "gemini", args }
    }
    case "codex": {
      if (hasSession.codex) {
        return { cmd: "codex", args: ["exec", "resume", "--last", prompt] }
      }
      return { cmd: "codex", args: ["exec", prompt] }
    }
    case "copilot":
      return { cmd: "gh", args: ["copilot", "suggest", "-t", "shell", prompt] }
    default:
      return { cmd: backend, args: [prompt] }
  }
}

function runCommand(backend, prompt, cwd) {
  const resolvedCwd = (cwd || "~").replace("~", homedir())
  const { cmd, args } = resolveBackendCommand(backend, prompt)

  const proc = spawn(cmd, args, {
    cwd: resolvedCwd,
    shell: false, // args are already split; avoid shell quoting issues
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" }
  })
  // Close stdin so CLIs don't wait for input
  proc.stdin.end()
  const pid = proc.pid
  activeProcesses.set(pid, proc)

  let hadOutput = false

  proc.stdout.on("data", (data) => {
    hadOutput = true
    sendMessage({ type: "stdout", data: data.toString(), pid, backend })
  })

  proc.stderr.on("data", (data) => {
    sendMessage({ type: "stderr", data: data.toString(), pid, backend })
  })

  proc.on("close", (code) => {
    activeProcesses.delete(pid)
    // On successful exit with output, mark session as live for this backend
    if (code === 0 && hadOutput && backend !== "copilot") {
      hasSession[backend] = true
    }
    sendMessage({ type: "exit", data: "", pid, code, backend })
  })

  proc.on("error", (err) => {
    activeProcesses.delete(pid)
    sendMessage({ type: "error", data: err.message, pid, backend })
  })

  sendMessage({ type: "started", pid, data: "", backend })
}

async function main() {
  while (true) {
    const msg = await readMessage()

    switch (msg.type) {
      case "exec": {
        const backend = msg.backend || "claude"
        runCommand(backend, msg.command, msg.cwd)
        break
      }

      case "exec-raw": {
        const cwd = (msg.cwd || "~").replace("~", homedir())
        try {
          const proc = spawn(msg.command, msg.args || [], {
            cwd,
            shell: true,
            stdio: ["pipe", "pipe", "pipe"],
            env: { ...process.env, NO_COLOR: "1" }
          })
          proc.stdin.end()
          const pid = proc.pid
          activeProcesses.set(pid, proc)

          proc.stdout.on("data", (data) => {
            sendMessage({ type: "stdout", data: data.toString(), pid })
          })
          proc.stderr.on("data", (data) => {
            sendMessage({ type: "stderr", data: data.toString(), pid })
          })
          proc.on("close", (code) => {
            activeProcesses.delete(pid)
            sendMessage({ type: "exit", data: "", pid, code })
          })
          proc.on("error", (err) => {
            activeProcesses.delete(pid)
            sendMessage({ type: "error", data: err.message, pid })
          })
          sendMessage({ type: "started", pid, data: "" })
        } catch (err) {
          sendMessage({ type: "error", data: err.message })
        }
        break
      }

      case "reset-backend": {
        // Clear the session flag — next exec will start fresh
        const backend = msg.backend || "claude"
        hasSession[backend] = false
        sendMessage({ type: "session-reset", backend, data: "" })
        break
      }

      case "session-status": {
        sendMessage({ type: "session-status", data: JSON.stringify(hasSession) })
        break
      }

      case "kill": {
        const proc = activeProcesses.get(msg.pid)
        if (proc) {
          proc.kill("SIGTERM")
          activeProcesses.delete(msg.pid)
          sendMessage({ type: "killed", pid: msg.pid, data: "" })
        }
        break
      }

      case "cwd": {
        sendMessage({ type: "cwd", data: (msg.cwd || "~").replace("~", homedir()) })
        break
      }

      case "config": {
        const config = getClaudeConfig(msg.configPath || "~/.claude.json")
        sendMessage({ type: "config", data: JSON.stringify(config || {}) })
        break
      }

      case "mcp": {
        if (msg.action === "list") {
          // Use `claude mcp list` to get the full picture — claude.ai integrations,
          // plugin servers, user/project config — with live connection status.
          const servers = await listAllMCPServers()
          sendMessage({ type: "mcp", data: JSON.stringify(servers) })
        } else if (msg.action === "add") {
          const configPath = (msg.configPath || "~/.claude.json").replace("~", homedir())
          let config = {}
          if (existsSync(configPath)) {
            try { config = JSON.parse(readFileSync(configPath, "utf-8")) } catch {}
          }
          if (!config.mcpServers) config.mcpServers = {}
          config.mcpServers[msg.server.name] = {
            command: msg.server.command,
            args: msg.server.args || [],
            env: msg.server.env || {}
          }
          const { writeFileSync } = await import("fs")
          writeFileSync(configPath, JSON.stringify(config, null, 2))
          sendMessage({ type: "mcp", data: JSON.stringify({ ok: true }) })
        }
        break
      }

      case "ping": {
        sendMessage({ type: "pong", data: "" })
        break
      }
    }
  }
}

main().catch((err) => {
  sendMessage({ type: "error", data: `Host error: ${err.message}` })
  process.exit(1)
})
