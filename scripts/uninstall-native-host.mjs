#!/usr/bin/env node
/**
 * Uninstalls everything install-native-host.mjs sets up.
 *
 *   node scripts/uninstall-native-host.mjs [--purge-recordings]
 *
 * - Removes native messaging manifests from all browser dirs.
 * - Removes ~/.config/ai-dev-sidebar/{mcp-token,env,claude}.
 * - Strips ai-dev-sidebar from ~/.claude.json (preserves siblings).
 * - Removes the marker-guarded PATH block from ~/.zshrc / ~/.bashrc.
 * - Optionally removes ~/.config/ai-dev-sidebar/recordings/ with --purge-recordings.
 *
 * Idempotent — safe to re-run.
 */

import { existsSync, unlinkSync, rmSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import {
  HOST_NAME,
  setTerminalPath,
  removeTokenAndEnv,
  unregisterClaudeJson,
  configDir
} from "../native-host/installer.mjs"

const purgeRecordings = process.argv.includes("--purge-recordings")
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
  const p = join(d, `${HOST_NAME}.json`)
  if (existsSync(p)) {
    try {
      unlinkSync(p)
      console.log(`✓ Removed manifest: ${p}`)
    } catch (e) {
      console.log(`  Could not remove ${p}: ${e.message}`)
    }
  } else {
    console.log(`· No manifest at ${p}`)
  }
}

// Token + env
removeTokenAndEnv()
console.log(`✓ Removed token + env from ~/.config/ai-dev-sidebar`)

// ~/.claude.json entry
try {
  const next = unregisterClaudeJson()
  if (next) console.log(`✓ Removed ai-dev-sidebar from ~/.claude.json`)
  else console.log(`· No ~/.claude.json to clean`)
} catch (err) {
  console.warn(`⚠  Could not update ~/.claude.json: ${err.message}`)
}

// Shell rc + wrapper
const results = setTerminalPath(false)
for (const r of results) {
  console.log(`${r.changed ? "✓" : "·"} ${r.path}`)
}

// Optional: recordings
if (purgeRecordings) {
  const recDir = join(configDir(), "recordings")
  if (existsSync(recDir)) {
    try {
      rmSync(recDir, { recursive: true, force: true })
      console.log(`✓ Removed recordings: ${recDir}`)
    } catch (e) {
      console.warn(`⚠  Could not remove ${recDir}: ${e.message}`)
    }
  } else {
    console.log(`· No recordings dir to purge`)
  }
} else {
  console.log(`· Recordings preserved (use --purge-recordings to remove)`)
}

console.log("\nDone! Uninstall complete.")
