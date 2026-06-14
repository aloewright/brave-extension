/// <reference types="chrome" />
import { beforeEach } from "vitest"

// In-memory chrome.storage.local shim. Values are deep-cloned on get/set
// to mirror the structured-clone semantics of the real extension runtime.

type StoreValue = unknown
type Store = Record<string, StoreValue>

const clone = <T,>(value: T): T => {
  if (value === undefined) return value
  // structuredClone is available in Node 17+ and happy-dom.
  return structuredClone(value)
}

function createStorageShim() {
  let store: Store = {}

  const normalizeKeys = (
    keys: string | string[] | Record<string, unknown> | null | undefined
  ): { keys: string[]; defaults: Record<string, unknown> } => {
    if (keys == null) return { keys: Object.keys(store), defaults: {} }
    if (typeof keys === "string") return { keys: [keys], defaults: {} }
    if (Array.isArray(keys)) return { keys, defaults: {} }
    return { keys: Object.keys(keys), defaults: keys as Record<string, unknown> }
  }

  return {
    local: {
      async get(
        keys: string | string[] | Record<string, unknown> | null | undefined
      ): Promise<Record<string, unknown>> {
        const { keys: list, defaults } = normalizeKeys(keys)
        const out: Record<string, unknown> = {}
        for (const k of list) {
          if (k in store) {
            out[k] = clone(store[k])
          } else if (k in defaults) {
            out[k] = clone(defaults[k])
          }
        }
        return out
      },
      async set(items: Record<string, unknown>): Promise<void> {
        for (const [k, v] of Object.entries(items)) {
          store[k] = clone(v)
        }
      },
      async remove(keys: string | string[]): Promise<void> {
        const list = Array.isArray(keys) ? keys : [keys]
        for (const k of list) delete store[k]
      },
      async clear(): Promise<void> {
        store = {}
      },
      // Test helper — not part of the chrome.storage API
      __reset(): void {
        store = {}
      },
      __dump(): Store {
        return clone(store)
      }
    }
  }
}

const shim = {
  storage: createStorageShim()
}

;(globalThis as unknown as { chrome: typeof shim }).chrome = shim

beforeEach(() => {
  shim.storage.local.__reset()
})
