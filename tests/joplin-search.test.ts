import { describe, it, expect, vi } from "vitest"
import { searchNotes } from "../src/lib/joplin/search"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("searchNotes", () => {
  it("sends query, type, fields, order_by, order_dir", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await searchNotes("rust", {}, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/search")
    expect(url).toContain("query=rust")
    expect(url).toContain("type=note")
    expect(url).toContain("order_by=updated_time")
    expect(url).toContain("order_dir=DESC")
  })

  it("type defaults to 'note'", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await searchNotes("x", {}, "tok", f)
    expect((f.mock.calls[0][0] as string)).toContain("type=note")
  })

  it("propagates sub-100 cap to limit query param", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await searchNotes("x", { cap: 20 }, "tok", f)
    expect((f.mock.calls[0][0] as string)).toContain("limit=20")
  })

  it("auto-paginates through has_more", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n1" }], has_more: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n2" }], has_more: false })
      )
    const out = await searchNotes("x", {}, "tok", f)
    expect(out.items.map((n) => n.id)).toEqual(["n1", "n2"])
  })

  it("reports truncated=true when cap reached mid-fetch", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ items: new Array(100).fill({ id: "x" }), has_more: true })
      )
    const out = await searchNotes("x", { cap: 20 }, "tok", f)
    expect(out.items.length).toBe(20)
    expect(out.truncated).toBe(true)
  })
})
