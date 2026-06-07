// tests/github/registry.test.ts
import { describe, it, expect } from "vitest"
import { isFeatureOn, type FeatureMeta } from "../../src/lib/github/registry"

const meta = (id: string, defaultEnabled: boolean): FeatureMeta => ({
  id, name: id, description: "", category: "global", defaultEnabled,
  pageTest: () => true, init: () => {}
})

describe("isFeatureOn", () => {
  const reg = { a: meta("a", true), b: meta("b", false) }
  it("master off ⇒ everything off", () => {
    expect(isFeatureOn("a", { enabled: false, features: {} }, reg)).toBe(false)
  })
  it("falls back to defaultEnabled when no override", () => {
    expect(isFeatureOn("a", { enabled: true, features: {} }, reg)).toBe(true)
    expect(isFeatureOn("b", { enabled: true, features: {} }, reg)).toBe(false)
  })
  it("override wins over default", () => {
    expect(isFeatureOn("b", { enabled: true, features: { b: true } }, reg)).toBe(true)
    expect(isFeatureOn("a", { enabled: true, features: { a: false } }, reg)).toBe(false)
  })
})
