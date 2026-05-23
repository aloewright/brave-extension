import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  SESSION_SNIPPETS_KEY,
  addSessionSnippet,
  clearSnippets,
  copyToClipboardViaTab,
  getSnippets,
  removeSnippet,
  subscribeToSnippets
} from "../src/lib/session-snippets"

describe("session snippets (ALO-470)", () => {
  beforeEach(async () => {
    await chrome.storage.local.clear()
  })

  it("returns an empty list on first read", async () => {
    expect(await getSnippets()).toEqual([])
  })

  it("addSessionSnippet writes a new snippet with the expected shape", async () => {
    const snip = await addSessionSnippet({
      text: "hello",
      sourceUrl: "https://example.com",
      sourceTitle: "Example"
    })
    expect(snip.text).toBe("hello")
    expect(snip.sourceUrl).toBe("https://example.com")
    expect(snip.sourceTitle).toBe("Example")
    expect(snip.type).toBe("selection")
    expect(typeof snip.id).toBe("string")
    expect(snip.createdAt).toBeGreaterThan(0)
    const all = await getSnippets()
    expect(all).toHaveLength(1)
    expect(all[0].id).toBe(snip.id)
  })

  it("newer snippets land at the head", async () => {
    const a = await addSessionSnippet({ text: "a", sourceUrl: "u1" })
    const b = await addSessionSnippet({ text: "b", sourceUrl: "u2" })
    const all = await getSnippets()
    expect(all[0].id).toBe(b.id)
    expect(all[1].id).toBe(a.id)
  })

  it("removeSnippet drops only the targeted id", async () => {
    const a = await addSessionSnippet({ text: "a", sourceUrl: "u1" })
    const b = await addSessionSnippet({ text: "b", sourceUrl: "u2" })
    await removeSnippet(a.id)
    const remaining = await getSnippets()
    expect(remaining).toHaveLength(1)
    expect(remaining[0].id).toBe(b.id)
  })

  it("clearSnippets empties the store", async () => {
    await addSessionSnippet({ text: "a", sourceUrl: "u1" })
    await addSessionSnippet({ text: "b", sourceUrl: "u2" })
    await clearSnippets()
    expect(await getSnippets()).toEqual([])
  })

  it("subscribeToSnippets is a no-op when chrome.storage.onChanged is missing", () => {
    // The test shim doesn't ship onChanged. The subscribe helper must
    // degrade to a no-op so production callers can still call it safely.
    const unsubscribe = subscribeToSnippets(() => {})
    expect(typeof unsubscribe).toBe("function")
    expect(() => unsubscribe()).not.toThrow()
  })

  it("subscribeToSnippets calls the listener when onChanged fires", () => {
    type StorageChange = chrome.storage.StorageChange
    type StorageListener = (
      changes: Record<string, StorageChange>,
      area: string
    ) => void
    const listeners: StorageListener[] = []
    const origOnChanged = (globalThis as any).chrome.storage.onChanged
    ;(globalThis as any).chrome.storage.onChanged = {
      addListener: (l: StorageListener) => listeners.push(l),
      removeListener: (l: StorageListener) => {
        const i = listeners.indexOf(l)
        if (i !== -1) listeners.splice(i, 1)
      }
    }
    try {
      const seen: number[] = []
      const unsubscribe = subscribeToSnippets((list) => seen.push(list.length))
      expect(listeners).toHaveLength(1)
      const fakeSnippets = [{ id: "1", text: "x", sourceUrl: "u", sourceTitle: null, createdAt: 0, type: "selection" }]
      listeners[0]({ [SESSION_SNIPPETS_KEY]: { newValue: fakeSnippets } as any }, "local")
      expect(seen).toEqual([1])
      // Wrong area is ignored.
      listeners[0]({ [SESSION_SNIPPETS_KEY]: { newValue: [...fakeSnippets, fakeSnippets[0]] } as any }, "sync")
      expect(seen).toEqual([1])
      unsubscribe()
      expect(listeners).toHaveLength(0)
    } finally {
      ;(globalThis as any).chrome.storage.onChanged = origOnChanged
    }
  })

  it("copyToClipboardViaTab returns false when scripting is unavailable", async () => {
    const real = (globalThis as any).chrome.scripting
    ;(globalThis as any).chrome.scripting = undefined
    try {
      expect(await copyToClipboardViaTab(1, "x")).toBe(false)
    } finally {
      ;(globalThis as any).chrome.scripting = real
    }
  })

  it("copyToClipboardViaTab returns true when executeScript reports success", async () => {
    const original = (globalThis as any).chrome.scripting
    ;(globalThis as any).chrome.scripting = {
      executeScript: vi.fn().mockResolvedValue([{ result: true }])
    }
    try {
      expect(await copyToClipboardViaTab(1, "hello")).toBe(true)
      expect((globalThis as any).chrome.scripting.executeScript).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { tabId: 1 },
          args: ["hello"]
        })
      )
    } finally {
      ;(globalThis as any).chrome.scripting = original
    }
  })

  it("storage uses the documented key", () => {
    expect(SESSION_SNIPPETS_KEY).toBe("session.snippets")
  })
})
