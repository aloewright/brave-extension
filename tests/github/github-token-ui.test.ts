import { describe, it, expect } from "vitest"
import { GH_TOKEN_SECRET_NAMES, pickGitHubToken } from "../../src/sections/github/github-token-ui"

describe("pickGitHubToken", () => {
  it("prefers GITHUB_PAT then falls back through candidates", () => {
    expect(pickGitHubToken({ GH_TOKEN: "b", GITHUB_PAT: "a" })).toBe("a")
    expect(pickGitHubToken({ GH_TOKEN: "b" })).toBe("b")
    expect(pickGitHubToken({})).toBe("")
  })
  it("exposes the candidate list for the Doppler request", () => {
    expect(GH_TOKEN_SECRET_NAMES[0]).toBe("GITHUB_PAT")
  })
})
