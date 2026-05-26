#!/usr/bin/env node
/**
 * Strip com.apple.quarantine from native addons under every repo node_modules
 * tree (node-pty, esbuild, rollup *.node, fsevents.node, swift-manifest, …).
 * See README macOS Gatekeeper section (ALO-472).
 */
import { resolve, join } from "path"
import { scrubQuarantineAll } from "../native-host/installer.mjs"

const repoRoot = resolve(join(import.meta.dirname, ".."))
const { errors } = scrubQuarantineAll(repoRoot)
for (const e of errors) {
  console.warn(`[scrub-quarantine] ${e.path}: ${e.message}`)
}
