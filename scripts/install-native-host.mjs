#!/usr/bin/env node
/**
 * Installs the native messaging host manifest for Chrome/Brave, plus the
 * config dir, token/env file, ~/.claude.json entry, and (optionally) the
 * shell rc PATH block + claude wrapper for "available in any terminal".
 *
 *   node scripts/install-native-host.mjs [extension-id] [--enable-terminal-path]
 *
 * Idempotent — re-running converges to the same final state. The terminal-
 * path block is marker-guarded so toggling it on/off is a clean round-trip.
 */

import { writeFileSync, mkdirSync, chmodSync, existsSync } from "fs"
import { homedir } from "os"
import { join, resolve } from "path"
import { spawnSync } from "child_process"
import {
  HOST_NAME,
  setTerminalPath,
  generateToken,
  writeTokenAndEnv,
  registerClaudeJson,
  tokenPath,
  envPath
} from "../native-host/installer.mjs"

const args = process.argv.slice(2)
const extensionId = args.find((a) => !a.startsWith("--")) || "*"
const enableTerminalPath = args.includes("--enable-terminal-path")

const hostPath = resolve(join(import.meta.dirname, "..", "native-host", "ai-dev-host.mjs"))

const manifest = {
  name: HOST_NAME,
  description: "AI Dev Sidebar native messaging host — bridges browser to local CLI tools",
  path: hostPath,
  type: "stdio",
  allowed_origins: extensionId === "*"
    ? ["chrome-extension://*/"]
    : [`chrome-extension://${extensionId}/`]
}

if (extensionId === "*") {
  console.log("⚠  No extension ID provided. You'll need to update the manifest after loading the extension.")
  console.log("   Usage: node scripts/install-native-host.mjs <extension-id> [--enable-terminal-path]")
  console.log("")
}

const platform = process.platform
const manifestDirs = []
if (platform === "darwin") {
  manifestDirs.push(
    join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
    join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
    join(homedir(), "Library", "Application Support", "Chromium", "NativeMessagingHosts")
  )
} else if (platform === "linux") {
  manifestDirs.push(join(homedir(), ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"))
} else if (platform === "win32") {
  manifestDirs.push(join(homedir(), "AppData", "Local", "AiDevSidebar", "NativeMessagingHosts"))
}

for (const d of manifestDirs) {
  try {
    mkdirSync(d, { recursive: true })
    const p = join(d, `${HOST_NAME}.json`)
    writeFileSync(p, JSON.stringify(manifest, null, 2))
    console.log(`✓ Installed manifest: ${p}`)
  } catch (e) {
    console.log(`  Skipped ${d}: ${e.message}`)
  }
}

if (platform === "win32") {
  console.log(`⚠  On Windows, also add registry key:`)
  console.log(`   HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`)
}

// Make host executable
try {
  chmodSync(hostPath, 0o755)
  console.log(`✓ Host executable: ${hostPath}`)
} catch {}

// Install native-host npm dependencies
const hostDir = resolve(join(import.meta.dirname, "..", "native-host"))
if (existsSync(join(hostDir, "package.json"))) {
  const hasNodeModules = existsSync(join(hostDir, "node_modules"))
  if (!hasNodeModules) {
    console.log(`\nInstalling native-host dependencies in ${hostDir}…`)
    const pm = spawnSync(
      process.platform === "win32" ? "pnpm.cmd" : "pnpm",
      ["install", "--prod", "--silent"],
      { cwd: hostDir, stdio: "inherit" }
    )
    if (pm.status !== 0) {
      console.warn("⚠  pnpm install failed; falling back to npm…")
      const np = spawnSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["install", "--omit=dev", "--silent"],
        { cwd: hostDir, stdio: "inherit" }
      )
      if (np.status !== 0) {
        console.warn("⚠  Could not install native-host deps automatically.")
      }
    } else {
      console.log("✓ Native-host dependencies installed")
    }
  } else {
    console.log("✓ Native-host node_modules already present")
  }
}

// Token + env file (placeholder port — real port is chosen at MCP server
// start; the host rotates the token and rewrites these files at startup).
// We pre-seed so that ~/.claude.json registration has something to point at
// and so terminals launched before the host first runs still see env vars.
if (!existsSync(tokenPath()) || !existsSync(envPath())) {
  const token = generateToken()
  writeTokenAndEnv(token, 8473)
  console.log(`✓ Wrote ~/.config/ai-dev-sidebar/{mcp-token,env}`)
} else {
  console.log(`✓ Token + env already present (rotated on host start)`)
}

// ~/.claude.json registration (port 8473 default; host updates if it picks
// a different port from PORT_RANGE).
try {
  registerClaudeJson(8473)
  console.log(`✓ Registered ai-dev-sidebar in ~/.claude.json`)
} catch (err) {
  console.warn(`⚠  Could not write ~/.claude.json: ${err.message}`)
}

// Optional: terminal path block + wrapper
if (enableTerminalPath) {
  const results = setTerminalPath(true)
  for (const r of results) {
    console.log(`${r.changed ? "✓" : "·"} ${r.path}`)
  }
  console.log(`\n  "Available in any terminal" enabled. Restart your shell or run:`)
  console.log(`    source ~/.zshrc  # or ~/.bashrc`)
}

console.log("\nDone! Restart your browser for changes to take effect.")
