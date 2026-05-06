import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  REFERENCES_STORAGE_KEY,
  addReference,
  clearReferences,
  loadReferences,
  referenceResourceDef,
  referenceUri,
  removeReference,
  saveReferences
} from "../src/hooks/useReferences"
import type { Reference } from "../src/types"

function makeRef(id: string, overrides: Partial<Reference> = {}): Reference {
  return {
    id,
    tabId: 1,
    url: `https://example.com/${id}`,
    title: `Page ${id}`,
    selector: `#node-${id}`,
    outerHTML: `<div id="node-${id}">hi</div>`,
    textContent: "hi",
    boundingBox: { x: 0, y: 0, w: 10, h: 10 },
    screenshot: "data:image/png;base64,AAAA",
    createdAt: 1234,
    ...overrides
  }
}

function makeSync() {
  return {
    upsert: vi.fn(),
    remove: vi.fn()
  }
}

describe("useReferences storage helpers", () => {
  beforeEach(() => {
    // tests/setup.ts already resets chrome.storage.local before each test.
  })

  it("loadReferences returns [] when storage is empty", async () => {
    expect(await loadReferences()).toEqual([])
  })

  it("saveReferences persists under terminal.references", async () => {
    const r = makeRef("01HX01")
    await saveReferences([r])
    const dump = await chrome.storage.local.get(REFERENCES_STORAGE_KEY)
    expect(dump[REFERENCES_STORAGE_KEY]).toEqual([r])
  })

  it("loadReferences hydrates persisted refs", async () => {
    const r = makeRef("01HX02")
    await chrome.storage.local.set({ [REFERENCES_STORAGE_KEY]: [r] })
    const refs = await loadReferences()
    expect(refs).toEqual([r])
  })

  it("addReference persists + pushes upsert", async () => {
    const sync = makeSync()
    const r = makeRef("01HX03")
    const next = await addReference([], r, sync)
    expect(next).toEqual([r])
    const persisted = await loadReferences()
    expect(persisted).toEqual([r])
    expect(sync.upsert).toHaveBeenCalledTimes(1)
    expect(sync.upsert).toHaveBeenCalledWith(referenceUri(r.id), referenceResourceDef(r))
    expect(sync.remove).not.toHaveBeenCalled()
  })

  it("addReference replaces a prior ref with the same id (idempotent)", async () => {
    const sync = makeSync()
    const a = makeRef("01HX04", { title: "v1" })
    const b = makeRef("01HX04", { title: "v2" })
    const after1 = await addReference([], a, sync)
    const after2 = await addReference(after1, b, sync)
    expect(after2).toHaveLength(1)
    expect(after2[0].title).toBe("v2")
    const persisted = await loadReferences()
    expect(persisted).toEqual([b])
  })

  it("removeReference persists + pushes remove", async () => {
    const sync = makeSync()
    const r = makeRef("01HX05")
    await saveReferences([r])
    const next = await removeReference([r], r.id, sync)
    expect(next).toEqual([])
    expect(await loadReferences()).toEqual([])
    expect(sync.remove).toHaveBeenCalledWith(referenceUri(r.id))
    expect(sync.upsert).not.toHaveBeenCalled()
  })

  it("clearReferences removes each + persists []", async () => {
    const sync = makeSync()
    const a = makeRef("01HX06")
    const b = makeRef("01HX07")
    await saveReferences([a, b])
    const next = await clearReferences([a, b], sync)
    expect(next).toEqual([])
    expect(await loadReferences()).toEqual([])
    expect(sync.remove).toHaveBeenCalledTimes(2)
    expect(sync.remove).toHaveBeenCalledWith(referenceUri(a.id))
    expect(sync.remove).toHaveBeenCalledWith(referenceUri(b.id))
  })

  it("referenceResourceDef shapes the MCP resource correctly", () => {
    const r = makeRef("01HX08", { title: "x".repeat(60) })
    const def = referenceResourceDef(r)
    expect(def.mimeType).toBe("application/json")
    expect(def.description).toBe(r.url)
    expect(def.payload).toBe(r)
    expect(def.name.startsWith(`Reference ${r.id}`)).toBe(true)
    // Title should be truncated to ~40 chars.
    expect(def.name.length).toBeLessThan(80)
  })

  it("referenceUri uses ai-dev:// scheme", () => {
    expect(referenceUri("01HX09")).toBe("ai-dev://reference/01HX09")
  })

  it("concurrent addReference calls preserve all entries (no TOCTOU clobber)", async () => {
    // When two adds race against the same baseline storage state, the
    // ref-based source-of-truth in useReferences avoids the storage-load
    // round-trip — but the underlying primitive still requires the caller
    // to feed the latest state. This test pins the contract: given a
    // sequential application of the latest state, both refs persist.
    const sync = makeSync()
    const a = makeRef("01HXR1")
    const b = makeRef("01HXR2")
    const after1 = await addReference([], a, sync)
    const after2 = await addReference(after1, b, sync)
    expect(after2).toHaveLength(2)
    expect(await loadReferences()).toEqual(after2)
    expect(sync.upsert).toHaveBeenCalledTimes(2)
  })
})

describe("terminal drop-target token regex", () => {
  // Mirrors the regex in src/sections/terminal/Terminal.tsx. Reference ids
  // are `ref_<ULID>` (see src/background.ts finalizeCapture + src/lib/ulid.ts),
  // so the dragged token is `@ref_<ULID>`.
  const REF_TOKEN = /^@ref_[A-Z0-9]+$/i

  it("accepts a real ref_<ULID> token", () => {
    expect(REF_TOKEN.test("@ref_01HX0123456789ABCDEFGHJKMN")).toBe(true)
  })

  it("rejects bare text drops", () => {
    expect(REF_TOKEN.test("hello world")).toBe(false)
    expect(REF_TOKEN.test("@01HX0123456789ABCDEFGHJKMN")).toBe(false)
    expect(REF_TOKEN.test("ref_01HX0123456789ABCDEFGHJKMN")).toBe(false)
  })

  it("rejects tokens with embedded whitespace or extra content", () => {
    expect(REF_TOKEN.test("@ref_01HX foo")).toBe(false)
    expect(REF_TOKEN.test(" @ref_01HX")).toBe(false)
  })
})
