import { describe, it, expect } from "vitest"
import {
  codeBlockOverhead,
  stripFormatting
} from "../src/components/VirtualizedChat"

// PDX-124 regression: `String.prototype.match` returns RegExpMatchArray | null,
// and `|| []` previously fell back to `never[]`, which made TypeScript infer
// the reduce accumulator as `never` (typecheck error). codeBlockOverhead now
// uses `?? []` with an explicit `string[]` annotation so the math runs cleanly.
// These tests pin the runtime behavior across that fix.
describe("codeBlockOverhead", () => {
  it("returns 0 when there are no fenced code blocks", () => {
    expect(codeBlockOverhead("plain text, no code blocks here")).toBe(0)
  })

  it("returns 0 for an empty string", () => {
    expect(codeBlockOverhead("")).toBe(0)
  })

  it("counts a single block with N lines as N*16 + 16", () => {
    const block = "```ts\nconst a = 1\nconst b = 2\n```"
    // Block has 4 lines after splitting on \n: ["```ts", "const a = 1", "const b = 2", "```"]
    expect(codeBlockOverhead(`prefix ${block} suffix`)).toBe(4 * 16 + 16)
  })

  it("sums multiple blocks", () => {
    const a = "```\nfoo\n```" // 3 lines → 3*16 + 16 = 64
    const b = "```js\nbar\nbaz\n```" // 4 lines → 4*16 + 16 = 80
    expect(codeBlockOverhead(`${a}\nbody\n${b}`)).toBe(64 + 80)
  })

  it("handles match() returning null without throwing", () => {
    // Sanity-check the null-coalescing path: text with backticks but no
    // closing fence should not match the regex at all.
    expect(codeBlockOverhead("``` unclosed fence")).toBe(0)
  })
})

describe("stripFormatting", () => {
  it("strips ANSI escape codes", () => {
    expect(stripFormatting("\x1b[31mred\x1b[0m text")).toBe("red text")
  })

  it("removes code-fence markers and inline backticks", () => {
    expect(stripFormatting("```ts\ncode\n```")).toBe("code\n")
    expect(stripFormatting("inline `code` here")).toBe("inline code here")
  })

  it("strips bold markers", () => {
    expect(stripFormatting("**bold** text")).toBe("bold text")
  })
})
