#!/usr/bin/env node
/**
 * Diagnose the native-host install on this machine — useful when the
 * sidebar terminal hangs at startup, when macOS Gatekeeper has been seen
 * popping "Apple could not verify '<random>.node' is free of malware",
 * or when investigating a quarantine state on a fresh install.
 *
 *   node scripts/diagnose-native-host.mjs [--fix]
 *
 * With `--fix`, re-runs the macOS quarantine scrub across native-host's
 * node_modules tree. Idempotent — safe to re-run.
 */

import { resolve, join } from "path"
import {
  findNativeArtifacts,
  inspectNativeArtifact,
  scrubQuarantine
} from "../native-host/installer.mjs"

const fix = process.argv.includes("--fix")
const hostDir = resolve(join(import.meta.dirname, "..", "native-host"))
const nodeModulesDir = join(hostDir, "node_modules")

console.log(`Native-host root: ${hostDir}`)
console.log(`Platform: ${process.platform} ${process.arch}`)
console.log("")

const artifacts = findNativeArtifacts(nodeModulesDir)
if (artifacts.length === 0) {
  console.log("No native artifacts found. Run `pnpm install-host` first.")
  process.exit(0)
}

console.log(`Found ${artifacts.length} native artifact(s):\n`)

let problemCount = 0
for (const path of artifacts) {
  const info = inspectNativeArtifact(path)
  const short = path.replace(hostDir, "<native-host>")
  const flags = []
  if (info.hasQuarantine) {
    flags.push("QUARANTINED")
    problemCount++
  }
  if (info.signing === "unsigned") {
    flags.push("UNSIGNED")
  }
  const flagText = flags.length > 0 ? ` ⚠ ${flags.join(",")}` : ""
  console.log(`  ${short}`)
  console.log(
    `    size=${info.sizeBytes}b signing=${info.signing}` +
      `${info.teamIdentifier ? ` team=${info.teamIdentifier}` : ""}` +
      ` xattrs=[${info.xattrs.join(",") || "none"}]${flagText}`
  )
}

console.log("")
if (problemCount > 0) {
  console.log(`⚠  ${problemCount} artifact(s) still carry com.apple.quarantine.`)
  if (fix) {
    const { scrubbed, errors } = scrubQuarantine(nodeModulesDir)
    console.log(`✓ Scrubbed ${scrubbed.length} artifact(s)`)
    for (const e of errors) console.warn(`  ⚠  ${e.path}: ${e.message}`)
  } else {
    console.log(`   Re-run with --fix to scrub them now.`)
  }
} else if (process.platform === "darwin") {
  console.log(`✓ No quarantine xattrs detected on native artifacts.`)
  console.log(
    `  If Gatekeeper still pops on first sidebar terminal use, open\n` +
      `  System Settings → Privacy & Security and click "Allow Anyway".\n` +
      `  Ad-hoc-signed prebuilds (no Developer ID) keep stable CDHashes\n` +
      `  across reinstalls of the same node-pty version, so the grant persists.`
  )
}
