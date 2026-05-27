import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.hoisted ensures the mock variables are available when vi.mock factory runs
// (vi.mock calls are hoisted to the top of the file by Vitest's transformer).
const { extractClipMock, createNoteMock, prependMock } = vi.hoisted(() => ({
  extractClipMock: vi.fn(),
  createNoteMock: vi.fn(),
  prependMock: vi.fn()
}))

vi.mock("../src/lib/clip-extractors", () => ({ extractClip: extractClipMock }))
vi.mock("../src/lib/joplin", () => ({
  createNote: createNoteMock,
  joplinNoteUrl: (id: string) => `joplin://x-callback-url/openNote?id=${id}`
}))
vi.mock("../src/lib/joplin-recents", () => ({ prependRecentClip: prependMock }))

import { handleClipRequest } from "../src/lib/joplin-clip-handler"
import type { Clip, ClipResultEvent } from "../src/lib/joplin-types"

function makeDeps(broadcastSink: ClipResultEvent[] = []) {
  return {
    getJoplinToken: async () => "tok",
    broadcast: (ev: ClipResultEvent) => { broadcastSink.push(ev) },
    newId: () => "id-1",
    now: () => new Date("2026-05-26T12:00:00Z")
  }
}

describe("handleClipRequest", () => {
  beforeEach(() => {
    extractClipMock.mockReset()
    createNoteMock.mockReset()
    prependMock.mockReset()
  })

  it("happy path: extract → post → persist → broadcast success", async () => {
    const clip: Clip = {
      title: "Hi",
      body: null,
      bodyHtml: "<p>x</p>",
      sourceUrl: "http://x",
      mode: "simplified"
    }
    extractClipMock.mockResolvedValue(clip)
    createNoteMock.mockResolvedValue("note-abc")
    prependMock.mockResolvedValue(undefined)

    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "simplified", tabId: 42 },
      makeDeps(sink)
    )

    expect(createNoteMock).toHaveBeenCalledWith(
      { title: "Hi", body: undefined, bodyHtml: "<p>x</p>", sourceUrl: "http://x" },
      "tok"
    )
    expect(prependMock).toHaveBeenCalledTimes(1)
    expect(sink).toHaveLength(1)
    expect(sink[0]).toMatchObject({
      type: "joplin/clip-result",
      status: "success",
      mode: "simplified",
      title: "Hi",
      recentClip: {
        id: "id-1",
        joplinNoteId: "note-abc",
        title: "Hi",
        mode: "simplified",
        sourceUrl: "http://x",
        joplinUrl: "joplin://x-callback-url/openNote?id=note-abc"
      }
    })
  })

  it("broadcasts error when extractClip throws", async () => {
    extractClipMock.mockRejectedValue(new Error("Readability couldn't parse this page."))
    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "simplified", tabId: 42 },
      makeDeps(sink)
    )
    expect(createNoteMock).not.toHaveBeenCalled()
    expect(sink[0]).toMatchObject({
      status: "error",
      error: "Readability couldn't parse this page."
    })
  })

  it("broadcasts error when createNote throws", async () => {
    extractClipMock.mockResolvedValue({
      title: "T", body: "x", bodyHtml: null, sourceUrl: "http://x", mode: "url-only"
    })
    createNoteMock.mockRejectedValue(new Error("Couldn't reach Joplin on localhost:41184. Is the Web Clipper service enabled?"))
    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "url-only", tabId: 1 },
      makeDeps(sink)
    )
    expect(prependMock).not.toHaveBeenCalled()
    expect(sink[0]).toMatchObject({
      status: "error",
      error: expect.stringContaining("localhost:41184")
    })
  })

  it("still broadcasts success when prependRecentClip throws", async () => {
    extractClipMock.mockResolvedValue({
      title: "T", body: null, bodyHtml: "<p>x</p>", sourceUrl: "http://x", mode: "simplified"
    })
    createNoteMock.mockResolvedValue("note-abc")
    prependMock.mockRejectedValue(new Error("quota"))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const sink: ClipResultEvent[] = []
    await handleClipRequest(
      { type: "joplin/clip", mode: "simplified", tabId: 1 },
      makeDeps(sink)
    )
    expect(sink[0].status).toBe("success")
    expect(sink[0].recentClip).toBeDefined() // populated from in-memory, even though storage failed
    warnSpy.mockRestore()
  })
})
