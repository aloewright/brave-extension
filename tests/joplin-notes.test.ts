import { describe, it, expect, vi } from "vitest"
import {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
  getNoteResources,
  getNoteTags
} from "../src/lib/joplin/notes"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("createNote", () => {
  it("translates camelCase to snake_case in payload", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1" }))
    await createNote(
      {
        title: "T",
        body: "B",
        sourceUrl: "http://x",
        parentId: "p1",
        isTodo: true,
        todoDue: 1700000000000
      },
      "tok",
      f
    )
    const init = f.mock.calls[0][1] as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({
      title: "T",
      body: "B",
      source_url: "http://x",
      parent_id: "p1",
      is_todo: 1,
      todo_due: 1700000000000
    })
  })

  it("omits optional fields when undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1" }))
    await createNote({ title: "T" }, "tok", f)
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "T" })
  })

  it("returns the id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1" }))
    expect(await createNote({ title: "T" }, "tok", f)).toBe("n1")
  })

  it("throws when response has no id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await expect(createNote({ title: "T" }, "tok", f)).rejects.toThrow(
      /returned no id/
    )
  })
})

describe("getNote", () => {
  it("uses default fields when fields=undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1", title: "T" }))
    await getNote("n1", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Ctitle%2Cparent_id%2Cupdated_time")
  })

  it("uses provided fields when supplied", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "n1", body: "B" }))
    await getNote("n1", ["id", "body"], "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Cbody")
  })

  it("URL-encodes the id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "a/b" }))
    await getNote("a/b", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/notes/a%2Fb")
  })
})

describe("updateNote", () => {
  it("translates camelCase patch to snake_case", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await updateNote(
      "n1",
      { title: "T", parentId: "p2", todoCompleted: true, todoDue: 0 },
      "tok",
      f
    )
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({
      title: "T",
      parent_id: "p2",
      todo_completed: 1,
      todo_due: 0
    })
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("PUT")
  })

  it("sends body: {} on empty patch", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await updateNote("n1", {}, "tok", f)
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({})
  })
})

describe("deleteNote", () => {
  it("issues DELETE without body", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteNote("n1", "tok", f)
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("DELETE")
    expect(init.body).toBeUndefined()
  })
})

describe("listNotes", () => {
  it("auto-paginates through has_more", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n1" }], has_more: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "n2" }], has_more: false })
      )
    const out = await listNotes({}, "tok", f)
    expect(out.items.map((n) => n.id)).toEqual(["n1", "n2"])
    expect(out.truncated).toBe(false)
  })

  it("uses opts.fields when provided", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ fields: ["id", "body"] }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Cbody")
  })

  it("passes orderBy and orderDir to Joplin", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ orderBy: "title", orderDir: "ASC" }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("order_by=title")
    expect(url).toContain("order_dir=ASC")
  })

  it("propagates sub-100 cap to Joplin's limit query param", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ cap: 20 }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("limit=20")
  })

  it("uses limit=100 for caps >= 100", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotes({ cap: 500 }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("limit=100")
  })
})

describe("getNoteResources / getNoteTags", () => {
  it("getNoteResources returns paged resources for a noteId", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [{ id: "r1" }], has_more: false }))
    const out = await getNoteResources("n1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/notes/n1/resources")
    expect(out.items[0].id).toBe("r1")
  })

  it("getNoteTags returns paged tags for a noteId", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [{ id: "t1" }], has_more: false }))
    const out = await getNoteTags("n1", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/notes/n1/tags")
    expect(out.items[0].id).toBe("t1")
  })
})
