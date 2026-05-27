#!/usr/bin/env node
/**
 * Pre-load node-pty so macOS Gatekeeper can approve pty.node once during
 * install instead of on first sidebar terminal use. The popup may name a
 * hash like `.99bfbbed9bcd5adb-00000000.node` — that is XProtect's scan
 * copy of prebuilds/darwin-arm64/pty.node (or darwin-x64).
 */
import { spawnSync } from "child_process"
import { resolve, join, dirname } from "path"
import { fileURLToPath } from "url"
import {
  prepareNodePtyForGatekeeper,
  NODE_PTY_GATEKEEPER_HINT
} from "../native-host/installer.mjs"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(join(__dirname, ".."))
const nativeHostDir = join(repoRoot, "native-host")

if (process.platform !== "darwin") {
  process.exit(0)
}

const { paths, assessments } = prepareNodePtyForGatekeeper(nativeHostDir)
if (paths.length === 0) {
  console.warn("warm-node-pty: node-pty prebuilds not found — run pnpm install in native-host/")
  process.exit(0)
}

const rejected = assessments.filter((a) => a.status === "rejected")
if (rejected.length > 0) {
  console.log("node-pty Gatekeeper assessment (before load):")
  for (const a of rejected) {
    console.log(`  ⚠  ${a.path.replace(repoRoot, "<repo>")}`)
    console.log(`     ${a.detail.split("\n")[0]}`)
  }
  console.log(`\n${NODE_PTY_GATEKEEPER_HINT}\n`)
  console.log("Loading node-pty now so you can approve it in the dialog…")
}

const code = `
await import('node-pty');
console.log('✓ node-pty loaded');
`
const res = spawnSync(process.execPath, ["--input-type=module", "-e", code], {
  cwd: nativeHostDir,
  stdio: "inherit",
  env: { ...process.env, NO_COLOR: "1" }
})

if (res.status !== 0) {
  console.warn(`\n${NODE_PTY_GATEKEEPER_HINT}`)
  process.exit(res.status ?? 1)
}

if (rejected.length > 0) {
  console.log("Re-checking Gatekeeper after load…")
  const after = prepareNodePtyForGatekeeper(nativeHostDir)
  const still = after.assessments.filter((a) => a.status === "rejected")
  if (still.length > 0) {
    console.log(
      "  Still rejected by spctl — open System Settings → Privacy & Security → Allow Anyway for pty.node."
    )
  } else {
    console.log("  ✓ Gatekeeper now allows node-pty.")
  }
}
