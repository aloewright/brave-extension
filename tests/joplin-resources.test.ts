import { describe, it, expect, vi } from "vitest"
import { getResource, uploadResource } from "../src/lib/joplin/resources"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

describe("getResource", () => {
  it("URL-encodes id and uses default fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1", mime: "image/png" }))
    await getResource("a/b", undefined, "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("/resources/a%2Fb")
    expect(url).toContain("fields=id%2Ctitle%2Cmime%2Cfilename%2Cfile_extension%2Csize%2Cupdated_time")
  })

  it("uses provided fields", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1" }))
    await getResource("r1", ["id", "mime"], "tok", f)
    const url = f.mock.calls[0][0] as string
    expect(url).toContain("fields=id%2Cmime")
  })
})

describe("uploadResource", () => {
  it("sends multipart with data + props (full props)", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1" }))
    const blob = new Blob(["data"], { type: "image/png" })
    const id = await uploadResource(
      blob,
      { title: "T", filename: "x.png", mime: "image/png" },
      "tok",
      f
    )
    expect(id).toBe("r1")
    const init = f.mock.calls[0][1] as RequestInit
    const form = init.body as FormData
    expect(form.get("data")).toBeInstanceOf(Blob)
    expect(JSON.parse(form.get("props") as string)).toEqual({
      title: "T",
      filename: "x.png",
      mime: "image/png"
    })
  })

  it("omits optional props fields when undefined", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({ id: "r1" }))
    const blob = new Blob(["x"])
    await uploadResource(blob, {}, "tok", f)
    const form = (f.mock.calls[0][1] as RequestInit).body as FormData
    expect(JSON.parse(form.get("props") as string)).toEqual({})
  })

  it("throws on response without id", async () => {
    const f = vi.fn().mockResolvedValue(jsonResponse({}))
    const blob = new Blob(["x"])
    await expect(uploadResource(blob, {}, "tok", f)).rejects.toThrow(/returned no id/)
  })
})
