// src/lib/github/runtime.ts
import type { GitHubFeatureSettings } from "../../types"
import { featureMap, isFeatureOn, type FeatureMeta } from "./registry"

export interface Runtime {
  start: (settings: GitHubFeatureSettings) => Promise<void>
  apply: (settings: GitHubFeatureSettings) => Promise<void>
  stop: () => void
}

export function createRuntime(
  features: FeatureMeta[],
  getUrl: () => URL = () => new URL(location.href)
): Runtime {
  const registry = featureMap(features)
  const active = new Map<string, AbortController>()
  let current: GitHubFeatureSettings = { enabled: false, features: {} }

  const desired = (settings: GitHubFeatureSettings): Set<string> => {
    const url = getUrl()
    const out = new Set<string>()
    for (const feature of features) {
      if (isFeatureOn(feature.id, settings, registry) && feature.pageTest(url)) out.add(feature.id)
    }
    return out
  }

  const reconcile = async (settings: GitHubFeatureSettings) => {
    current = settings
    const want = desired(settings)
    for (const [id, ctrl] of active) {
      if (!want.has(id)) { ctrl.abort(); active.delete(id) }
    }
    for (const id of want) {
      if (active.has(id)) continue
      const ctrl = new AbortController()
      active.set(id, ctrl)
      try { await registry[id].init(ctrl.signal) } catch (e) { console.debug("[gh]", id, e) }
    }
  }

  const onNav = () => { void reconcile(current) }

  return {
    start: async (settings) => {
      window.addEventListener("popstate", onNav)
      // GitHub uses pushState for SPA nav; patch to emit an event we listen to.
      patchHistory()
      window.addEventListener("rgh:navigate", onNav)
      await reconcile(settings)
    },
    apply: (settings) => reconcile(settings),
    stop: () => {
      window.removeEventListener("popstate", onNav)
      window.removeEventListener("rgh:navigate", onNav)
      for (const [, ctrl] of active) ctrl.abort()
      active.clear()
    }
  }
}

let patched = false
function patchHistory(): void {
  if (patched) return
  patched = true
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method]
    history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args)
      window.dispatchEvent(new Event("rgh:navigate"))
      return result
    }
  }
}
