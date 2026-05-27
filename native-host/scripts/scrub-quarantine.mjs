#!/usr/bin/env node
/**
 * native-host postinstall — scrub only this package's node_modules.
 * The repo-root script also covers native-host when run from postinstall there.
 */
import { dirname, join } from "path"
import { fileURLToPath } from "url"
import { scrubQuarantine } from "../installer.mjs"

const hostDir = fileURLToPath(new URL('..', import.meta.url))
const { errors } = scrubQuarantine(join(hostDir, "node_modules"))
for (const e of errors) {
  console.warn(`[scrub-quarantine] ${e.path}: ${e.message}`)
}
