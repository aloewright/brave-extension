// src/contents/readability-bundle.ts
//
// Plasmo content-script entry. `matches: []` means Plasmo bundles this
// file but does NOT auto-inject it on any URL. The background loads it
// on demand via chrome.scripting.executeScript({ files: [<this file>] })
// before each clip in "simplified" mode.
//
// Exposes Readability on globalThis so the per-mode extractor's func
// (which runs in MAIN world but doesn't have its own imports) can read
// it via globalThis.__JoplinReadability__.

import type { PlasmoCSConfig } from "plasmo"
import { Readability } from "@mozilla/readability"

export const config: PlasmoCSConfig = {
  matches: []
}

;(globalThis as { __JoplinReadability__?: typeof Readability }).__JoplinReadability__ =
  Readability
