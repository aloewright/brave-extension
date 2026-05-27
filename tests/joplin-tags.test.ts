import { describe, it, expect, vi } from "vitest"
import {
  listTags,
  createTag,
  deleteTag,
  addTagToNote,
  removeTagFromNote,
  listNotesByTag
} from "../src/lib/joplin/tags"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("listTags", () => {
  it("returns paged tags", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ items: [{ id: "t1", title: "x" }], has_more: false })
      )
    const out = await listTags("tok", f)
    expect(out.items[0].id).toBe("t1")
  })
})

describe("createTag", () => {
  it("posts { title } and returns id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "t1" }))
    expect(await createTag("urgent", "tok", f)).toBe("t1")
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "urgent" })
  })

  it("throws when response has no id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await expect(createTag("x", "tok", f)).rejects.toThrow(/returned no id/)
  })
})

describe("deleteTag", () => {
  it("issues DELETE /tags/:id", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteTag("t1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/t1")
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("DELETE")
  })
})

describe("addTagToNote", () => {
  it("POSTs { id: noteId } to /tags/:tagId/notes", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await addTagToNote("n1", "t1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/t1/notes")
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ id: "n1" })
  })
})

describe("removeTagFromNote", () => {
  it("issues DELETE /tags/:tagId/notes/:noteId", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await removeTagFromNote("n1", "t1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/t1/notes/n1")
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("DELETE")
  })
})

describe("listNotesByTag", () => {
  it("URL-encodes the tagId and honors opts", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotesByTag("a/b", { cap: 20 }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/tags/a%2Fb/notes")
    expect(url).toContain("limit=20")
  })
})
