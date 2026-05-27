import { describe, it, expect, vi } from "vitest"
import {
  createNote,
  ping,
  joplinNoteUrl,
  JoplinClientError
} from "../src/lib/joplin-client"

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  })
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" }
  })
}

describe("joplin-client.createNote", () => {
  it("URL-encodes the token and sends body field for body input", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: "abc" }))
    const id = await createNote(
      { title: "T", body: "hello", sourceUrl: "http://x" },
      "tok&en",
      fetchFn
    )
    expect(id).toBe("abc")
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe("http://localhost:41184/notes?token=tok%26en")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body as string)).toEqual({
      title: "T",
      source_url: "http://x",
      body: "hello"
    })
  })

  it("sends body_html (not body) when bodyHtml input is provided", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ id: "abc" }))
    await createNote(
      { title: "T", bodyHtml: "<p>hi</p>", sourceUrl: "http://x" },
      "tok",
      fetchFn
    )
    const init = fetchFn.mock.calls[0][1]
    const parsed = JSON.parse(init.body as string)
    expect(parsed.body_html).toBe("<p>hi</p>")
    expect(parsed.body).toBeUndefined()
  })

  it("throws JoplinClientError(0) when the token is empty", async () => {
    const fetchFn = vi.fn()
    await expect(
      createNote({ title: "T", body: "x", sourceUrl: "http://x" }, "", fetchFn)
    ).rejects.toBeInstanceOf(JoplinClientError)
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it("throws JoplinClientError(0) with friendly message on fetch rejection", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError("ECONNREFUSED"))
    try {
      await createNote(
        { title: "T", body: "x", sourceUrl: "http://x" },
        "tok",
        fetchFn
      )
      throw new Error("should have thrown")
    } catch (err) {
      expect(err).toBeInstanceOf(JoplinClientError)
      expect((err as JoplinClientError).status).toBe(0)
      expect((err as Error).message).toContain("localhost:41184")
    }
  })

  it("throws JoplinClientError(401) with truncated body on auth error", async () => {
    const longBody = "x".repeat(500)
    const fetchFn = vi.fn().mockResolvedValue(textResponse(longBody, 401))
    try {
      await createNote(
        { title: "T", body: "x", sourceUrl: "http://x" },
        "tok",
        fetchFn
      )
      throw new Error("should have thrown")
    } catch (err) {
      expect((err as JoplinClientError).status).toBe(401)
      expect((err as Error).message.length).toBeLessThanOrEqual(250)
    }
  })

  it("throws when response has no id", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}))
    await expect(
      createNote(
        { title: "T", body: "x", sourceUrl: "http://x" },
        "tok",
        fetchFn
      )
    ).rejects.toBeInstanceOf(JoplinClientError)
  })
})

describe("joplin-client.ping", () => {
  it("returns true when body contains JoplinClipperServer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(textResponse("JoplinClipperServer"))
    expect(await ping(fetchFn)).toBe(true)
  })
  it("returns false on non-2xx", async () => {
    const fetchFn = vi.fn().mockResolvedValue(textResponse("nope", 500))
    expect(await ping(fetchFn)).toBe(false)
  })
  it("returns false on fetch rejection", async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error("boom"))
    expect(await ping(fetchFn)).toBe(false)
  })
})

describe("joplin-client.joplinNoteUrl", () => {
  it("builds the joplin:// deep link", () => {
    expect(joplinNoteUrl("abc123")).toBe(
      "joplin://x-callback-url/openNote?id=abc123"
    )
  })
})
