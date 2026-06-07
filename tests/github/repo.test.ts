import { describe, it, expect } from "vitest"
import { parseRepo } from "../../src/lib/github/repo"

describe("parseRepo", () => {
  it("parses owner/name", () => {
    expect(parseRepo(new URL("https://github.com/o/r/pull/1")))
      .toMatchObject({ owner: "o", name: "r", nameWithOwner: "o/r" })
  })
  it("parses branch + filePath from a blob url", () => {
    expect(parseRepo(new URL("https://github.com/o/r/blob/main/src/a.ts")))
      .toMatchObject({ owner: "o", name: "r", branch: "main", filePath: "src/a.ts" })
  })
  it("returns null off-repo", () => {
    expect(parseRepo(new URL("https://github.com/settings"))).toBeNull()
  })
})
