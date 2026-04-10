#!/usr/bin/env node
/**
 * Installs the native messaging host manifest for Chrome/Brave.
 * Run: node scripts/install-native-host.mjs [extension-id]
 */

import { writeFileSync, mkdirSync, chmodSync } from "fs"
import { homedir } from "os"
import { join, resolve } from "path"

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

console.log("\nDone! Restart your browser for changes to take effect.")
