import { describe, it, expect } from "vitest"
import * as pd from "../../src/lib/github/page-detect"

const u = (s: string) => new URL(s)

describe("page-detect", () => {
  it("isRepoRoot", () => {
    expect(pd.isRepoRoot(u("https://github.com/o/r"))).toBe(true)
    expect(pd.isRepoRoot(u("https://github.com/o/r/pull/1"))).toBe(false)
  })
  it("isPR / isPRFiles", () => {
    expect(pd.isPR(u("https://github.com/o/r/pull/12"))).toBe(true)
    expect(pd.isPRFiles(u("https://github.com/o/r/pull/12/files"))).toBe(true)
    expect(pd.isPRFiles(u("https://github.com/o/r/pull/12"))).toBe(false)
  })
  it("isIssue", () => {
    expect(pd.isIssue(u("https://github.com/o/r/issues/3"))).toBe(true)
    expect(pd.isIssue(u("https://github.com/o/r/issues"))).toBe(false)
  })
  it("isCommit / isProfile / isDashboard / isNotFound", () => {
    expect(pd.isCommit(u("https://github.com/o/r/commit/abc"))).toBe(true)
    expect(pd.isProfile(u("https://github.com/octocat"))).toBe(true)
    expect(pd.isProfile(u("https://github.com/o/r"))).toBe(false)
    expect(pd.isDashboard(u("https://github.com/"))).toBe(true)
    expect(pd.isNewRepo(u("https://github.com/new"))).toBe(true)
  })
})
