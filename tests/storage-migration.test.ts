import { describe, it } from "vitest"

// Spec §4: "One-time best-effort migration from any installed lean-extensions
// storage" — at the time of writing (M8) no migration helper has been
// committed. This test is a TODO marker so the gap stays visible. Once the
// migration is implemented (likely in src/storage.ts or src/sections/_lx/
// storage.ts), unskip and assert old `_lx`-prefixed keys are rewritten to the
// new namespaced layout with values preserved.

describe.skip("one-time _lx storage migration (TODO)", () => {
  it("rewrites legacy _lx-prefixed keys into the namespaced layout", () => {
    // Pseudocode for the future implementation:
    //   await chrome.storage.local.set({ _lx_profiles: [...], _lx_groups: [...] })
    //   await runOneTimeMigration()
    //   const after = await chrome.storage.local.get(null)
    //   expect(after).not.toHaveProperty("_lx_profiles")
    //   expect(after.lx_profiles).toEqual([...])
  })
})
