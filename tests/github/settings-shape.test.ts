import { describe, it, expect } from "vitest"
import { DEFAULT_SETTINGS } from "../../src/types"

describe("github settings", () => {
  it("defaults to enabled master switch and empty overrides", () => {
    expect(DEFAULT_SETTINGS.github).toEqual({ enabled: true, features: {} })
  })
})
