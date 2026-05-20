import { describe, expect, it } from "vitest"
import { chunkText } from "../src/chunk"

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("hello world", { maxChars: 1000, overlapChars: 100 })
    expect(chunks).toEqual(["hello world"])
  })

  it("returns [] for empty/whitespace input", () => {
    expect(chunkText("", { maxChars: 100, overlapChars: 10 })).toEqual([])
    expect(chunkText("   \n  ", { maxChars: 100, overlapChars: 10 })).toEqual([])
  })

  it("splits long text into overlapping windows", () => {
    const text = "a".repeat(2500)
    const chunks = chunkText(text, { maxChars: 1000, overlapChars: 100 })
    expect(chunks.length).toBeGreaterThan(2)
    expect(chunks[0]!.length).toBeLessThanOrEqual(1000)
    for (let i = 1; i < chunks.length; i++) {
      const prevTail = chunks[i - 1]!.slice(-100)
      expect(chunks[i]!.startsWith(prevTail)).toBe(true)
    }
  })

  it("prefers splitting at paragraph boundaries when possible", () => {
    const text = "para one.\n\n" + "para two has more content. ".repeat(50)
    const chunks = chunkText(text, { maxChars: 200, overlapChars: 20 })
    expect(chunks[0]!.endsWith("\n\n") || chunks[0]!.endsWith(".") || chunks[0]!.endsWith(" ")).toBe(true)
  })
})
