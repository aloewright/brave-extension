#!/usr/bin/env node
/**
 * Installs the native messaging host manifest for Chrome/Brave.
 * Run: node scripts/install-native-host.mjs [extension-id]
 */

import { writeFileSync, mkdirSync, chmodSync, existsSync } from "fs"
import { homedir } from "os"
import { join, resolve } from "path"
import { spawnSync } from "child_process"

const HOST_NAME = "com.aidev.sidebar"
const extensionId = process.argv[2] || "*"
const hostPath = resolve(join(import.meta.dirname, "..", "native-host", "ai-dev-host.mjs"))

const manifest = {
  name: HOST_NAME,
  description: "AI Dev Sidebar native messaging host — bridges browser to local CLI tools",
  path: hostPath,
  type: "stdio",
  allowed_origins: extensionId === "*"
    ? []
    : [`chrome-extension://${extensionId}/`]
}

// If wildcard, use allowed_origins with the extension id pattern
if (extensionId === "*") {
  console.log("⚠  No extension ID provided. You'll need to update the manifest after loading the extension.")
  console.log("   Usage: node scripts/install-native-host.mjs <extension-id>")
  console.log("")
  // Still install with empty origins — user can update
  manifest.allowed_origins = ["chrome-extension://*/"]
}

const platform = process.platform

let manifestDir
if (platform === "darwin") {
  // Brave and Chrome share native messaging on macOS
  const dirs = [
    join(homedir(), "Library", "Application Support", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts"),
    join(homedir(), "Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"),
    join(homedir(), "Library", "Application Support", "Chromium", "NativeMessagingHosts")
  ]
  for (const d of dirs) {
    try {
      mkdirSync(d, { recursive: true })
      const p = join(d, `${HOST_NAME}.json`)
      writeFileSync(p, JSON.stringify(manifest, null, 2))
      console.log(`✓ Installed: ${p}`)
    } catch (e) {
      console.log(`  Skipped ${d}: ${e.message}`)
    }
  }
} else if (platform === "linux") {
  manifestDir = join(homedir(), ".config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts")
  mkdirSync(manifestDir, { recursive: true })
  const p = join(manifestDir, `${HOST_NAME}.json`)
  writeFileSync(p, JSON.stringify(manifest, null, 2))
  console.log(`✓ Installed: ${p}`)
} else if (platform === "win32") {
  // Windows uses registry — just write the manifest file
  manifestDir = join(homedir(), "AppData", "Local", "AiDevSidebar", "NativeMessagingHosts")
  mkdirSync(manifestDir, { recursive: true })
  const p = join(manifestDir, `${HOST_NAME}.json`)
  writeFileSync(p, JSON.stringify(manifest, null, 2))
  console.log(`✓ Installed: ${p}`)
  console.log(`⚠  On Windows, you also need to add a registry key:`)
  console.log(`   HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`)
  console.log(`   Default value: ${p}`)
}

// Make host executable
try {
  chmodSync(hostPath, 0o755)
  console.log(`✓ Made host executable: ${hostPath}`)
} catch {}

// Install native-host npm dependencies (node-pty prebuilt + future MCP server deps).
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
      console.warn(
        "⚠  pnpm install failed in native-host/. Falling back to npm…"
      )
      const np = spawnSync(
        process.platform === "win32" ? "npm.cmd" : "npm",
        ["install", "--omit=dev", "--silent"],
        { cwd: hostDir, stdio: "inherit" }
      )
      if (np.status !== 0) {
        console.warn(
          "⚠  Could not install native-host deps automatically. Run `pnpm install` (or npm install) inside native-host/ to enable the PTY terminal."
        )
      }
    } else {
      console.log("✓ Native-host dependencies installed")
    }
  } else {
    console.log("✓ Native-host node_modules already present")
  }
}

console.log("\nDone! Restart your browser for changes to take effect.")
