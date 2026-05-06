// Generate a unique CSS selector for an element.
//
// Strategy:
//   1. If the element has an id and that id is unique in the document, use #id.
//   2. Walk up the tree building tag.class:nth-of-type(n) segments, stopping
//      as soon as `document.querySelectorAll(selector).length === 1`.
//   3. Fall back to the full path to <html> if uniqueness can't be reached.

function cssEscape(s: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(s)
  return s.replace(/[^a-zA-Z0-9_-]/g, "_")
}

function isValidId(id: string): boolean {
  // Skip generated framework ids that are likely unstable across renders.
  if (!id) return false
  if (/^[0-9]/.test(id)) return false
  if (id.length > 64) return false
  return true
}

function nthOfType(el: Element): number {
  let i = 1
  let sib = el.previousElementSibling
  while (sib) {
    if (sib.tagName === el.tagName) i++
    sib = sib.previousElementSibling
  }
  return i
}

function segmentFor(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const classes =
    el.className && typeof el.className === "string"
      ? el.className.trim().split(/\s+/).filter(Boolean).slice(0, 3)
      : []
  const base = classes.length ? `${tag}.${classes.map(cssEscape).join(".")}` : tag
  return `${base}:nth-of-type(${nthOfType(el)})`
}

function isUnique(root: Document | DocumentFragment, sel: string, target: Element): boolean {
  try {
    const matches = root.querySelectorAll(sel)
    return matches.length === 1 && matches[0] === target
  } catch {
    return false
  }
}

export function buildUniqueSelector(el: Element, doc: Document = document): string {
  if (el.id && isValidId(el.id)) {
    const idSel = `#${cssEscape(el.id)}`
    if (isUnique(doc, idSel, el)) return idSel
  }

  const parts: string[] = []
  let cur: Element | null = el
  while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
    parts.unshift(segmentFor(cur))
    const sel = parts.join(" > ")
    if (isUnique(doc, sel, el)) return sel
    cur = cur.parentElement
  }

  // Anchor at <html> if needed.
  if (parts.length === 0 || parts[0].indexOf("html") !== 0) {
    parts.unshift("html")
  }
  return parts.join(" > ")
}
