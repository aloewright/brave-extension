import { describe, it, expect, vi } from "vitest"
import { ping, joplinNoteUrl } from "../src/lib/joplin/ping"
import { JOPLIN_BASE_URL } from "../src/lib/joplin/client"

describe("ping", () => {
  it("returns true when /ping body includes JoplinClipperServer", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response("JoplinClipperServer", { status: 200 }))
    expect(await ping(f)).toBe(true)
    expect(f.mock.calls[0][0]).toBe(`${JOPLIN_BASE_URL}/ping`)
  })

  it("returns false on non-2xx", async () => {
    const f = vi.fn().mockResolvedValue(new Response("oops", { status: 500 }))
    expect(await ping(f)).toBe(false)
  })

  it("returns false on fetch reject", async () => {
    const f = vi.fn().mockRejectedValue(new Error("boom"))
    expect(await ping(f)).toBe(false)
  })
})

describe("joplinNoteUrl", () => {
  it("builds the joplin:// deep link", () => {
    expect(joplinNoteUrl("abc")).toBe(
      "joplin://x-callback-url/openNote?id=abc"
    )
  })
})
