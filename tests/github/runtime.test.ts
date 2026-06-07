// tests/github/runtime.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest"
import { createRuntime } from "../../src/lib/github/runtime"
import type { FeatureMeta } from "../../src/lib/github/registry"

function meta(id: string, over: Partial<FeatureMeta> = {}): FeatureMeta {
  return {
    id, name: id, description: "", category: "global", defaultEnabled: true,
    pageTest: () => true, init: vi.fn(), ...over
  }
}

describe("runtime", () => {
  it("inits only enabled, page-matching features", async () => {
    const a = meta("a")
    const b = meta("b", { pageTest: () => false })
    const c = meta("c", { defaultEnabled: false })
    const rt = createRuntime([a, b, c], () => new URL("https://github.com/o/r"))
    await rt.start({ enabled: true, features: {} })
    expect(a.init).toHaveBeenCalledTimes(1)
    expect(b.init).not.toHaveBeenCalled()
    expect(c.init).not.toHaveBeenCalled()
    rt.stop()
  })

  it("master off inits nothing", async () => {
    const a = meta("a")
    const rt = createRuntime([a], () => new URL("https://github.com/o/r"))
    await rt.start({ enabled: false, features: {} })
    expect(a.init).not.toHaveBeenCalled()
    rt.stop()
  })

  it("re-running with new settings aborts removed features and inits added", async () => {
    const aborted: string[] = []
    const a = meta("a", { defaultEnabled: false, init: (s) => { s.addEventListener("abort", () => aborted.push("a")) } })
    const rt = createRuntime([a], () => new URL("https://github.com/o/r"))
    await rt.start({ enabled: true, features: { a: true } })
    expect(aborted).toEqual([])
    await rt.apply({ enabled: true, features: { a: false } })
    expect(aborted).toEqual(["a"])
    rt.stop()
  })

  it("a newer reconcile supersedes an in-flight slower one", async () => {
    let release: () => void = () => {}
    const slow = meta("slow", {
      defaultEnabled: false,
      init: () => new Promise<void>((r) => { release = r })
    })
    const fast = meta("fast", { defaultEnabled: false })
    const rt = createRuntime([slow, fast], () => new URL("https://github.com/o/r"))
    // First reconcile: wants only `slow`, which hangs on its init promise.
    const first = rt.apply({ enabled: true, features: { slow: true } })
    // Second reconcile starts before `slow` resolves: now wants only `fast`.
    const second = rt.apply({ enabled: true, features: { fast: true } })
    release()
    await Promise.all([first, second])
    expect(fast.init).toHaveBeenCalledTimes(1)
    rt.stop()
  })
})
