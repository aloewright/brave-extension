import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getKeepoutConnection,
  saveKeepoutCapture,
  saveKeepoutConnection,
  testKeepoutConnection,
  validateKeepoutCapture,
} from "../src/lib/keepout-client"

const PORT_KEY = "keepout.connection.port"
const TOKEN_KEY = "keepout.connection.token"
const TOKEN = "test-session-token"
const capture = {
  version: 1 as const,
  id: "550e8400-e29b-41d4-a716-446655440000",
  title: "A title",
  sourceUrl: "https://example.test/article",
  selection: "Selected text",
  marginNote: "A margin note",
}

type Store = Record<string, unknown>

function storageArea(store: Store) {
  return {
    async get(keys: string | null) {
      if (keys === null) return structuredClone(store)
      return keys in store ? { [keys]: structuredClone(store[keys]) } : {}
    },
    async set(items: Store) {
      Object.assign(store, structuredClone(items))
    },
    async remove(keys: string | string[]) {
      for (const key of Array.isArray(keys) ? keys : [keys]) delete store[key]
    },
    async setAccessLevel() {},
  }
}

let session: Store
let sync: Store

beforeEach(() => {
  session = {}
  sync = {}
  Object.assign(chrome.storage, {
    session: storageArea(session),
    sync: storageArea(sync),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function connect(port = 8721) {
  await saveKeepoutConnection({ port, token: TOKEN })
}

describe("keepout-client", () => {
  it("uses only a fixed loopback URL, bearer authentication, and redirect:error", async () => {
    await connect(9345)
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ version: 1, available: true })))
    vi.stubGlobal("fetch", fetchMock)

    await testKeepoutConnection()

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:9345/v1/captures/status",
      expect.objectContaining({
        method: "GET",
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: { Authorization: `Bearer ${TOKEN}` },
      }),
    )
  })

  it("keeps the token only in session storage, never local or sync storage", async () => {
    await connect(8721)

    expect((await chrome.storage.local.get(null))[PORT_KEY]).toBe(8721)
    expect(session[TOKEN_KEY]).toBe(TOKEN)
    expect(JSON.stringify(await chrome.storage.local.get(null))).not.toContain(TOKEN)
    expect(JSON.stringify(sync)).not.toContain(TOKEN)
    await expect(getKeepoutConnection()).resolves.toEqual({ port: 8721, token: TOKEN })
  })

  it.each([
    [{ ...capture, selection: "   " }, "empty selection"],
    [{ ...capture, sourceUrl: "file:///private/note" }, "non-web URL"],
    [{ ...capture, sourceUrl: "https://token@example.test/private" }, "credential-bearing URL"],
    [{ ...capture, selection: "x".repeat(256 * 1024) }, "oversized capture"],
  ])("rejects %s before any network request", (invalid) => {
    expect(() => validateKeepoutCapture(invalid)).toThrow()
  })

  it("filters unknown fields from the forwarded capture schema", () => {
    const clean = validateKeepoutCapture({ ...capture, injectedByPage: "must not cross the boundary" })
    expect(clean).toEqual(capture)
    expect(clean).not.toHaveProperty("injectedByPage")
  })

  it.each([401, 423, 404, 500])("never reports success for HTTP %i", async (status) => {
    await connect()
    vi.stubGlobal("fetch", vi.fn(async () => new Response("failure", { status })))

    await expect(saveKeepoutCapture(capture)).rejects.toThrow()
  })

  it.each([
    [{ id: "not-the-request-id", createdAt: "2026-09-19T00:00:00.000Z" }],
    [{ id: capture.id, createdAt: "not-a-date" }],
    [{ id: capture.id }],
  ])("rejects a malformed 201 confirmation", async (receipt) => {
    await connect()
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(receipt), { status: 201 })))

    await expect(saveKeepoutCapture(capture)).rejects.toThrow(/confirmation/i)
  })

  it("rejects a matching receipt unless the server created it with HTTP 201", async () => {
    await connect()
    const receipt = { id: capture.id, createdAt: "2026-09-19T00:00:00.000Z" }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(receipt), { status: 200 })))

    await expect(saveKeepoutCapture(capture)).rejects.toThrow(/confirmation|save/i)
  })

  it("accepts only a 201 receipt that confirms the matching capture id", async () => {
    await connect()
    const receipt = { id: capture.id, createdAt: "2026-09-19T00:00:00.000Z" }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(receipt), { status: 201 })))

    await expect(saveKeepoutCapture(capture)).resolves.toEqual(receipt)
  })
})
