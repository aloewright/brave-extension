import { describe, it, expect, vi } from "vitest"
import {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  listNotesInFolder
} from "../src/lib/joplin/folders"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("listFolders", () => {
  it("auto-paginates", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "f1", title: "A" }], has_more: true })
      )
      .mockResolvedValueOnce(
        jsonResponse({ items: [{ id: "f2", title: "B" }], has_more: false })
      )
    const out = await listFolders("tok", f)
    expect(out.items.map((f) => f.id)).toEqual(["f1", "f2"])
  })
})

describe("getFolder", () => {
  it("URL-encodes id and requests default fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "a/b", title: "X" }))
    await getFolder("a/b", "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/folders/a%2Fb")
    expect(url).toContain("fields=id%2Ctitle%2Cparent_id%2Cupdated_time")
  })
})

describe("createFolder", () => {
  it("maps parentId to parent_id and returns id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "f1" }))
    const id = await createFolder({ title: "T", parentId: "p1" }, "tok", f)
    expect(id).toBe("f1")
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "T", parent_id: "p1" })
  })

  it("omits parent_id when undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "f1" }))
    await createFolder({ title: "T" }, "tok", f)
    const body = JSON.parse(
      (f.mock.calls[0][1] as RequestInit).body as string
    )
    expect(body).toEqual({ title: "T" })
  })
})

describe("updateFolder", () => {
  it("PUTs the patched fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    await updateFolder("f1", { title: "New", parentId: "p2" }, "tok", f)
    const init = f.mock.calls[0][1] as RequestInit
    expect(init.method).toBe("PUT")
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ title: "New", parent_id: "p2" })
  })
})

describe("deleteFolder", () => {
  it("without force omits the force query param", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteFolder("f1", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).not.toContain("force=")
  })

  it("with force: true sends force=1", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    await deleteFolder("f1", { force: true }, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("force=1")
  })

  it("responds void on 200", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }))
    const out = await deleteFolder("f1", undefined, "tok", f)
    expect(out).toBeUndefined()
  })
})

describe("listNotesInFolder", () => {
  it("URL-encodes the folderId", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotesInFolder("a/b", {}, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/folders/a%2Fb/notes")
  })

  it("honors cap, orderBy, orderDir", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(jsonResponse({ items: [], has_more: false }))
    await listNotesInFolder(
      "f1",
      { cap: 50, orderBy: "title", orderDir: "ASC" },
      "tok",
      f
    )
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("order_by=title")
    expect(url).toContain("order_dir=ASC")
    expect(url).toContain("limit=50")
  })
})
