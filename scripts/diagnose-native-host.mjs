#!/usr/bin/env node
/**
 * Diagnose native Mach-O artifacts (node-pty, esbuild, rollup, fsevents, …)
 * across every repo node_modules tree — useful when macOS Gatekeeper pops
 * "Apple could not verify '<name>' is free of malware" during dev/build or
 * sidebar terminal use.
 *
 *   node scripts/diagnose-native-host.mjs [--fix]
 *
 * With `--fix`, re-runs the macOS quarantine scrub. Idempotent — safe to re-run.
 */

import { resolve, join, relative, dirname } from "path"
import { fileURLToPath } from "url"
import {
  findNativeArtifacts,
  findSwiftToolchainArtifacts,
  inspectNativeArtifact,
  repoNodeModuleRoots,
  scrubQuarantineAll
} from "../native-host/installer.mjs"

const fix = process.argv.includes("--fix")
const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(join(__dirname, ".."))
const roots = repoNodeModuleRoots(repoRoot)

console.log(`Repo root: ${repoRoot}`)
console.log(`Platform: ${process.platform} ${process.arch}`)
console.log("")

if (roots.length === 0) {
  console.log("Warning: No node_modules trees found. Run `pnpm install` first.")
}

const artifacts = [
  ...new Set([
    ...roots.flatMap((root) => findNativeArtifacts(root)),
    ...findSwiftToolchainArtifacts({ repoRoot, nativeHostDir: join(repoRoot, "native-host") })
  ])
].sort()
if (artifacts.length === 0) {
  console.log("No native artifacts found.")
  process.exit(0)
}

console.log(`Found ${artifacts.length} native artifact(s) across ${roots.length} tree(s):\n`)

let problemCount = 0
for (const path of artifacts) {
  const info = inspectNativeArtifact(path)
  const short = relative(repoRoot, path)
  const flags = []
  if (info.hasQuarantine) {
    flags.push("QUARANTINED")
    problemCount++
  }
  if (info.signing === "unsigned") {
    flags.push("UNSIGNED")
  }
  if (info.gatekeeperStatus === "rejected") {
    flags.push("GATEKEEPER_REJECTED")
    problemCount++
  }
  const flagText = flags.length > 0 ? ` ⚠ ${flags.join(",")}` : ""
  console.log(`  ${short}`)
  console.log(
    `    size=${info.sizeBytes}b signing=${info.signing}` +
      `${info.teamIdentifier ? ` team=${info.teamIdentifier}` : ""}` +
      ` xattrs=[${info.xattrs.join(",") || "none"}]` +
      `${info.gatekeeperStatus ? ` gatekeeper=${info.gatekeeperStatus}` : ""}${flagText}`
  )
  if (info.gatekeeperStatus === "rejected" && short.includes("pty.node")) {
    console.log(
      "    Gatekeeper popups may name .<hex>-00000000.node — that is this pty.node. Run `pnpm rebuild-pty`."
    )
  }
}

console.log("")
if (problemCount > 0) {
  console.log(`⚠  ${problemCount} native artifact issue(s) detected.`)
  if (fix) {
    const { scrubbed, errors } = scrubQuarantineAll(repoRoot)
    console.log(`✓ Scrubbed ${scrubbed.length} artifact(s)`)
    for (const e of errors) console.warn(`  ⚠  ${e.path}: ${e.message}`)
  } else {
    console.log(`   Re-run with --fix to scrub them now (or run \`pnpm scrub-native\`).`)
  }
} else if (process.platform === "darwin") {
  console.log(`✓ No quarantine xattrs detected on native artifacts.`)
  console.log(
    `  If Gatekeeper still pops on dev/build or first terminal use, run\n` +
      `  \`pnpm rebuild-pty\` to rebuild node-pty locally and scrub again.`
  )
}
