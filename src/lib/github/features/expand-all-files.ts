// src/lib/github/features/expand-all-files.ts
// Ported from RGH extend-diff-expander.tsx + extend-diff-expander.css.
// Expands the click target of diff context-expansion lines so clicking
// anywhere on the line triggers the expand, not just the tiny button.
// Also injects hover highlight CSS from RGH's extend-diff-expander.css.
import { injectStyle } from "../dom"
import { isPRFiles, isCommit, isSingleFile } from "../page-detect"
import type { FeatureMeta } from "../registry"

const KEY = "expand-all-files"

// RGH selectors (from extend-diff-expander.tsx):
// '.diff-view .js-expandable-line' — expandable lines in old view
// '.diff-line-row:has(button[data-direction])' — React view
// Native button selectors:
// '.js-expand' — old view
// 'button[data-direction]' — React view
const LINE_SELECTORS = [
  ".diff-view .js-expandable-line",
  ".diff-line-row:has(button[data-direction])",
]
const NATIVE_BTN_SELECTORS = [
  ".js-expand",
  "button[data-direction]",
]
const NATIVE_BTN_JOINED = NATIVE_BTN_SELECTORS.join(", ")

// CSS ported from RGH extend-diff-expander.css
const CSS = `
/* Ported from RGH extend-diff-expander.css */
.rgh-expand-all-files .js-expandable-line:hover :is(
  .blob-num:not(:hover) .directional-expander:first-child,
  .blob-num:not(:hover) + .blob-code
) {
  color: var(--control-checked-fgColor-rest, var(--color-fg-on-emphasis));
  background: var(--control-checked-bgColor-hover, var(--color-accent-emphasis));
  border-color: var(--control-checked-borderColor-hover, var(--color-accent-emphasis));
  cursor: pointer;
}
.rgh-expand-all-files .diff-line-row:has(button[data-direction]):hover {
  color: var(--diffBlob-hunkNum-fgColor-hover, var(--fgColor-onEmphasis));
  background: var(--diffBlob-hunkNum-bgColor-hover, var(--bgColor-accent-emphasis));
  cursor: pointer;
  transition: color 0.1s ease, background-color 0.1s ease;
}
.rgh-expand-all-files .diff-line-row:has(button[data-direction]):hover button[data-direction] {
  color: var(--diffBlob-hunkNum-fgColor-hover, var(--fgColor-onEmphasis));
  background: var(--diffBlob-hunkNum-bgColor-hover, var(--bgColor-accent-emphasis));
}
`

function handleClick(event: MouseEvent): void {
  const target = event.target as Node
  // Skip if user clicked directly on the native button
  if ((target as Element).closest?.(NATIVE_BTN_JOINED)) return
  const row = (target as Element).closest?.(LINE_SELECTORS.join(", ")) as HTMLElement | null
  if (!row) return
  row.querySelector<HTMLElement>(NATIVE_BTN_JOINED)?.click()
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Expand all diff files",
  description: "Makes the entire expandable-context line in diffs clickable, not just the small button.",
  category: "repository",
  defaultEnabled: true,
  pageTest: (url) => isPRFiles(url) || isCommit(url) || isSingleFile(url),
  init: (signal) => {
    document.body.classList.add("rgh-expand-all-files")
    injectStyle(KEY, CSS)

    document.addEventListener("click", handleClick, { signal })

    signal.addEventListener("abort", () => {
      document.body.classList.remove("rgh-expand-all-files")
      document.querySelector(`style[data-rgh="${KEY}"]`)?.remove()
    }, { once: true })
  }
}

export default feature
