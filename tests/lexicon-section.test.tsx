import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import React from "react"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function renderLexiconSection() {
  ;(globalThis as typeof globalThis & { React: typeof React }).React = React
  const { LexiconSection } = await import("../src/sections/lexicon/LexiconSection")
  const host = document.createElement("div")
  document.body.append(host)
  let root: Root | null = null
  await act(async () => {
    root = createRoot(host)
    root.render(<LexiconSection />)
  })
  await act(async () => {
    await Promise.resolve()
  })
  return {
    host,
    cleanup: () => {
      act(() => root?.unmount())
      host.remove()
    }
  }
}

describe("LexiconSection", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal("fetch", vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("opens without seeding a default word lookup", async () => {
    const { host, cleanup } = await renderLexiconSection()
    try {
      const input = host.querySelector<HTMLInputElement>("#lexicon-search")

      expect(input).toBeTruthy()
      expect(input?.value).toBe("")
      expect(host.textContent).not.toContain("serendipity")
      expect(host.textContent).toContain(
        "Search for a word to see dictionary and thesaurus entries."
      )
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })

  it("ignores the old persisted default word from earlier builds", async () => {
    await chrome.storage.local.set({
      "lexicon.lookup.v1": { word: "serendipity", mode: "dictionary" }
    })

    const { host, cleanup } = await renderLexiconSection()
    try {
      const input = host.querySelector<HTMLInputElement>("#lexicon-search")

      expect(input?.value).toBe("")
      expect(host.textContent).not.toContain("serendipity")
      expect(fetch).not.toHaveBeenCalled()
    } finally {
      cleanup()
    }
  })
})
