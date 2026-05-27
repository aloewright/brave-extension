import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  extractSimplifiedInPage,
  extractFullHtmlInPage,
  extractSelectionInPage,
  extractUrlOnlyInPage
} from "../src/lib/clip-extractors"

// happy-dom is the default vitest environment in this project (verify in
// vitest.config). If it isn't, set `// @vitest-environment happy-dom`
// at the top of this file.

function resetDocument(html: string, title: string, url = "http://example.test/page") {
  document.documentElement.innerHTML = html
  document.title = title
  // happy-dom respects manual location assignment.
  Object.defineProperty(window, "location", {
    value: new URL(url),
    configurable: true
  })
}

describe("extractSimplifiedInPage", () => {
  beforeEach(() => {
    resetDocument("<body><article><h1>Hi</h1><p>p</p></article></body>", "T")
    delete (globalThis as { __JoplinReadability__?: unknown }).__JoplinReadability__
  })

  it("returns null when Readability is missing", () => {
    expect(extractSimplifiedInPage()).toBeNull()
  })

  it("returns null when Readability.parse returns null", () => {
    ;(globalThis as any).__JoplinReadability__ = class {
      parse() { return null }
    }
    expect(extractSimplifiedInPage()).toBeNull()
  })

  it("returns a simplified Clip when Readability parses", () => {
    ;(globalThis as any).__JoplinReadability__ = class {
      parse() { return { title: "Real Title", content: "<p>Article</p>" } }
    }
    const clip = extractSimplifiedInPage()
    expect(clip).not.toBeNull()
    expect(clip!.title).toBe("Real Title")
    expect(clip!.bodyHtml).toBe("<p>Article</p>")
    expect(clip!.body).toBeNull()
    expect(clip!.mode).toBe("simplified")
    expect(clip!.sourceUrl).toBe("http://example.test/page")
  })

  it("falls back to document.title when Readability title is empty", () => {
    ;(globalThis as any).__JoplinReadability__ = class {
      parse() { return { title: "", content: "<p>x</p>" } }
    }
    resetDocument("<body></body>", "Doc Title")
    const clip = extractSimplifiedInPage()
    expect(clip!.title).toBe("Doc Title")
  })
})

describe("extractFullHtmlInPage", () => {
  it("returns full DOM as bodyHtml", () => {
    resetDocument("<body><p>hi</p></body>", "Full T")
    const clip = extractFullHtmlInPage()
    expect(clip.title).toBe("Full T")
    expect(clip.bodyHtml).toContain("<p>hi</p>")
    expect(clip.body).toBeNull()
    expect(clip.mode).toBe("full-html")
  })

  it("falls back to 'Untitled clip' when title is empty", () => {
    resetDocument("<body></body>", "")
    expect(extractFullHtmlInPage().title).toBe("Untitled clip")
  })
})

describe("extractSelectionInPage", () => {
  beforeEach(() => {
    resetDocument("<body><p id=t>selected text here</p></body>", "Sel T")
  })

  it("returns null when nothing is selected", () => {
    const sel = window.getSelection()
    sel?.removeAllRanges()
    expect(extractSelectionInPage()).toBeNull()
  })

  it("returns plain-text body when there is a selection", () => {
    const node = document.getElementById("t")!.firstChild!
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, node.textContent!.length)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
    const clip = extractSelectionInPage()
    expect(clip).not.toBeNull()
    expect(clip!.body).toBe("selected text here")
    expect(clip!.bodyHtml).toBeNull()
    expect(clip!.mode).toBe("selection")
  })
})

describe("extractUrlOnlyInPage", () => {
  it("emits a Markdown link in body", () => {
    resetDocument("<body></body>", "Title!", "http://x.test/abc")
    const clip = extractUrlOnlyInPage()
    expect(clip.body).toBe("[Title!](http://x.test/abc)")
    expect(clip.bodyHtml).toBeNull()
    expect(clip.title).toBe("Title!")
    expect(clip.mode).toBe("url-only")
  })

  it("falls back to URL as title when document.title is empty", () => {
    resetDocument("<body></body>", "", "http://x.test/abc")
    const clip = extractUrlOnlyInPage()
    expect(clip.title).toBe("http://x.test/abc")
  })
})
