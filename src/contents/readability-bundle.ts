// src/contents/readability-bundle.ts
//
// Plasmo content-script entry. Bundled as a named content-script file so the
// background can inject it on demand via:
//   chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: [READABILITY_BUNDLE_PATH] })
//
// Exposes Readability on globalThis so the per-mode extractor func
// (which runs in MAIN world without its own imports) can read it via
// globalThis.__JoplinReadability__.
//
// matches: ["<all_urls>"] is required by Chrome MV3 — an empty array causes
// "there must be at least one match" and rejects the whole manifest. The
// script is lightweight (assigns one global) and runs at document_idle so
// it does not meaningfully affect page performance.

import type { PlasmoCSConfig } from "plasmo"
import { Readability } from "@mozilla/readability"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"]
}

;(globalThis as { __JoplinReadability__?: typeof Readability }).__JoplinReadability__ =
  Readability
