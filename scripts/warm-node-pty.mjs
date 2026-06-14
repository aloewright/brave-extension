#!/usr/bin/env node
/**
 * Pre-load node-pty after clearing Gatekeeper/XProtect xattrs so the first
 * sidebar terminal does not surface macOS' scary `.hex-00000000.node` dialog.
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

const { paths, scrub } = prepareNodePtyForGatekeeper(nativeHostDir)
if (paths.length === 0) {
  console.warn("warm-node-pty: node-pty native addon not found — run pnpm install in native-host/")
  process.exit(0)
}

if (scrub.errors.length > 0) {
  console.warn("warm-node-pty: could not clear every node-pty native artifact:")
  for (const err of scrub.errors) {
    console.warn(`  ${err.path.replace(repoRoot, "<repo>")}: ${err.message}`)
  }
} else {
  console.log(`✓ Cleared Gatekeeper xattrs on ${scrub.scrubbed.length} node-pty native artifact(s).`)
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
  console.warn("If this keeps failing, run `pnpm rebuild-pty` to replace the downloaded prebuild with a local build.")
  process.exit(res.status ?? 1)
}

const afterImport = prepareNodePtyForGatekeeper(nativeHostDir)
if (afterImport.scrub.errors.length > 0) {
  console.warn("warm-node-pty: node-pty loaded, but post-import scrub had errors:")
  for (const err of afterImport.scrub.errors) {
    console.warn(`  ${err.path.replace(repoRoot, "<repo>")}: ${err.message}`)
  }
} else {
  console.log(`✓ Cleared post-import xattrs on ${afterImport.scrub.scrubbed.length} node-pty native artifact(s).`)
}

console.log("✓ node-pty loaded through Node without a Gatekeeper prompt.")
