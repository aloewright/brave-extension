// src/lib/github/features/show-whitespace-toggle.ts
// Port of RGH show-whitespace.tsx + show-whitespace.css
// Highlights leading/trailing whitespace (spaces and tabs) in code lines
// by wrapping them in spans with data-rgh-whitespace attributes, styled by CSS.

import { injectStyle, removeStyle } from "../dom"
import { observe } from "../observe"
import { isPRFiles, isCommit } from "../page-detect"
import type { FeatureMeta } from "../registry"

const KEY = "show-whitespace-toggle"

// Ported from RGH show-whitespace.css (verbatim selectors and SVG data URIs)
const CSS = `
[data-rgh-whitespace] {
  line-height: 1em;
  background-clip: border-box;
  background-repeat: repeat-x;
  background-position: left center;
}

[data-rgh-whitespace='tab'] {
  background-image: url('data:image/svg+xml,%3Csvg preserveAspectRatio="xMinYMid meet" viewBox="0 0 12 24" xmlns="http://www.w3.org/2000/svg"%3E%3Cpath d="M9.5 10.44L6.62 8.12L7.32 7.26L12.04 11V11.44L7.28 14.9L6.62 13.9L9.48 11.78H0V10.44H9.5Z" fill="rgba(128, 128, 128, 50%25)"/%3E%3C/svg%3E');
  background-size: calc(var(--tab-size) * 1ch) 1.25em;
  background-position: 2px center;
}

[data-rgh-whitespace='space'] {
  background-image: url('data:image/svg+xml,%3Csvg preserveAspectRatio="xMinYMid meet" viewBox="0 0 12 24" xmlns="http://www.w3.org/2000/svg"%3E%3Cpath d="M4.5 11C4.5 10.1716 5.17157 9.5 6 9.5C6.82843 9.5 7.5 10.1716 7.5 11C7.5 11.8284 6.82843 12.5 6 12.5C5.17157 12.5 4.5 11.8284 4.5 11Z" fill="rgba(128, 128, 128, 50%25)"/%3E%3C/svg%3E');
  background-size: 1ch 1.25em;
}
`

// Selectors from RGH codeElementsSelector (dom-formatters.tsx) combined as in show-whitespace.tsx
// The :not(.blob-code-hunk) exclusion is from the RGH observe() call
const CODE_SELECTOR = [
  ".blob-code-inner:not(deferred-diff-lines.awaiting-highlight *):not(.blob-code-hunk)",
  ".snippet-clipboard-content > pre.notranslate:not(.blob-code-hunk)",
  ".highlight > pre.notranslate:not(.blob-code-hunk)",
].join(", ")

/** Port of RGH get-text-nodes.ts */
function getTextNodes(element: Node): Text[] {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  let node: Node | null
  do {
    node = walker.nextNode()
    if (node) nodes.push(node as Text)
  } while (node)
  return nodes
}

/** Port of RGH show-whitespace-on-line.tsx — wraps leading/trailing whitespace in spans */
function showWhiteSpacesOnLine(line: Element, shouldAvoidSurroundingSpaces = false): void {
  const textNodesOnThisLine = getTextNodes(line)
  for (const [nodeIndex, textNode] of textNodesOnThisLine.entries()) {
    let text = textNode.textContent ?? ""
    if (text.length > 1000) continue

    const isLeading = nodeIndex === 0
    const isTrailing = nodeIndex === textNodesOnThisLine.length - 1
    const startingCharacterIndex = shouldAvoidSurroundingSpaces && isLeading ? 1 : 0
    const skipLastCharacter = shouldAvoidSurroundingSpaces && isTrailing
    const endingCharacterIndex = text.length - 1 - Number(skipLastCharacter)

    for (let index = endingCharacterIndex; index >= startingCharacterIndex; index--) {
      const thisCharacter = text[index]
      const endingIndex = index

      if (thisCharacter !== " " && thisCharacter !== "\t") continue

      while (text[index - 1] === thisCharacter && index !== startingCharacterIndex) {
        index--
      }

      // Skip non-boundary single spaces
      if (!isLeading && !isTrailing && index === endingIndex && thisCharacter === " ") continue

      if (endingIndex < text.length - 1) textNode.splitText(endingIndex + 1)
      textNode.splitText(index)
      text = textNode.textContent ?? ""

      const wsSpan = document.createElement("span")
      wsSpan.dataset.rghWhitespace = thisCharacter === "\t" ? "tab" : "space"
      const nextSibling = textNode.nextSibling
      if (nextSibling) wsSpan.append(nextSibling)
      textNode.after(wsSpan)
    }
  }
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Show whitespace",
  description: "Highlights leading and trailing spaces and tabs in code diffs.",
  category: "pull-requests",
  defaultEnabled: true,
  pageTest: (url) => isPRFiles(url) || isCommit(url),
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })

    const viewportObserver = new IntersectionObserver((changes) => {
      for (const { target: line, isIntersecting } of changes) {
        if (isIntersecting) {
          // #2285: avoid surrounding spaces for embedded blobs
          const shouldAvoid = Boolean(line.closest(".blob-wrapper-embedded"))
          showWhiteSpacesOnLine(line, shouldAvoid)
          viewportObserver.unobserve(line)
        }
      }
    })

    signal.addEventListener("abort", () => viewportObserver.disconnect(), { once: true })

    observe(CODE_SELECTOR, (line) => {
      viewportObserver.observe(line)
    }, { signal })
  }
}

export default feature
