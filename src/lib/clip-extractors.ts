// src/lib/clip-extractors.ts
//
// Per-mode page extraction. extractClip drives chrome.scripting.executeScript
// against the active tab; the per-mode `*InPage` functions are pure DOM
// functions exported separately so they can be unit-tested directly under
// happy-dom (the runtime path passes them to executeScript as `func`).

import type { Clip, ClipMode } from "./joplin-types"

// Filename emitted by scripts/build-extension.mjs for the content script that
// exposes __JoplinReadability__ on the page's globalThis.
export const READABILITY_BUNDLE_PATH = "content/readability-bundle.js"

/** Drives executeScript: inject Readability if needed, then run the per-mode extractor in MAIN world. */
export async function extractClip(tabId: number, mode: ClipMode): Promise<Clip> {
  if (mode === "simplified") {
    // Idempotent — re-running the file just re-assigns the global.
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      files: [READABILITY_BUNDLE_PATH]
    })
  }
  const fn = pickInPageFn(mode)
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: fn
  })
  if (result === null || result === undefined) {
    throw new Error(messageForNull(mode))
  }
  return result as Clip
}

function pickInPageFn(mode: ClipMode): () => Clip | null {
  switch (mode) {
    case "simplified":  return extractSimplifiedInPage
    case "full-html":   return extractFullHtmlInPage
    case "selection":   return extractSelectionInPage
    case "url-only":    return extractUrlOnlyInPage
  }
}

function messageForNull(mode: ClipMode): string {
  switch (mode) {
    case "simplified":  return "Readability couldn't parse this page."
    case "selection":   return "Nothing selected."
    case "full-html":
    case "url-only":    return "Couldn't extract page content."
  }
}

// === In-page extractors ===
// These run in the page's MAIN world via executeScript({ func }), which
// ships function source but not its imports. They MUST therefore reference
// only the page's globals (document, window, globalThis.__JoplinReadability__).
// They're exported here so they can also be called directly in happy-dom
// tests without the executeScript hop.

export function extractSimplifiedInPage(): Clip | null {
  const Readability = (
    globalThis as { __JoplinReadability__?: any }
  ).__JoplinReadability__
  if (!Readability) return null
  const docClone = document.cloneNode(true) as Document
  const article = new Readability(docClone).parse()
  if (!article) return null
  return {
    title: article.title || document.title || "Untitled clip",
    body: null,
    bodyHtml: article.content,
    sourceUrl: window.location.href,
    mode: "simplified"
  }
}

export function extractFullHtmlInPage(): Clip {
  return {
    title: document.title || "Untitled clip",
    body: null,
    bodyHtml: document.documentElement.outerHTML,
    sourceUrl: window.location.href,
    mode: "full-html"
  }
}

export function extractSelectionInPage(): Clip | null {
  const sel = window.getSelection()
  const text = sel?.toString() ?? ""
  if (!text.trim()) return null
  return {
    title: document.title || "Untitled clip",
    body: text,
    bodyHtml: null,
    sourceUrl: window.location.href,
    mode: "selection"
  }
}

export function extractUrlOnlyInPage(): Clip {
  const title = document.title || window.location.href
  return {
    title,
    body: `[${title}](${window.location.href})`,
    bodyHtml: null,
    sourceUrl: window.location.href,
    mode: "url-only"
  }
}
