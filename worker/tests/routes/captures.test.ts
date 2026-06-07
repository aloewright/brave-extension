import { describe, it, expect, vi } from "vitest"
import app from "../../src/index"
import { makeEnv } from "../helpers"
import { EMBED_DIMS } from "../../src/env"

const TOKEN_HEADERS = {
  "x-sidebar-token": "test-token"
}

function uploadRequest(args: {
  kind: string
  filename: string
  contentType?: string
  body: Uint8Array
  pageUrl?: string
  pageTitle?: string
}) {
  const headers: Record<string, string> = {
    ...TOKEN_HEADERS,
    "X-Capture-Kind": args.kind,
    "X-Capture-Filename": encodeURIComponent(args.filename),
    "content-type": args.contentType ?? "image/png"
  }
  if (args.pageUrl) headers["X-Capture-Page-Url"] = args.pageUrl
  if (args.pageTitle) headers["X-Capture-Page-Title"] = encodeURIComponent(args.pageTitle)
  return new Request("http://x/api/captures", {
    method: "POST",
    headers,
    body: args.body.buffer.slice(args.body.byteOffset, args.body.byteOffset + args.body.byteLength) as ArrayBuffer
  })
}

function stubAi(env: ReturnType<typeof makeEnv>, ocrText: string) {
  const aiRun = vi.fn(async (model: string, payload: unknown) => {
    if (model.endsWith("bge-base-en-v1.5")) {
      const texts = ((payload as { text?: string[] }).text) ?? []
      return { data: texts.map((_t, i) => Array.from({ length: EMBED_DIMS }, () => i * 0.001)) }
    }
    if (model.includes("llava")) {
      return { description: ocrText }
    }
    throw new Error(`unstubbed model: ${model}`)
  })
  env.AI = { run: aiRun } as unknown as Ai
  return aiRun
}

describe("POST /api/captures (ALO-468)", () => {
  it("rejects missing X-Capture-Kind", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      new Request("http://x/api/captures", {
        method: "POST",
        headers: { ...TOKEN_HEADERS, "content-type": "image/png" },
        body: new Uint8Array([1, 2, 3])
      }),
      env
    )
    expect(res.status).toBe(400)
  })

  it("rejects an invalid kind", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      uploadRequest({ kind: "video", filename: "x.png", body: new Uint8Array([1]) }),
      env
    )
    expect(res.status).toBe(400)
  })

  it("rejects missing filename", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      new Request("http://x/api/captures", {
        method: "POST",
        headers: { ...TOKEN_HEADERS, "X-Capture-Kind": "screenshot", "content-type": "image/png" },
        body: new Uint8Array([1])
      }),
      env
    )
    expect(res.status).toBe(400)
  })

  it("rejects an empty body", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      uploadRequest({ kind: "screenshot", filename: "x.png", body: new Uint8Array(0) }),
      env
    )
    expect(res.status).toBe(400)
  })

  it("uploads a screenshot, OCRs it, indexes it, and returns 201", async () => {
    const env = makeEnv()
    const aiRun = stubAi(env, "visible text on this page")
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    const res = await app.fetch(
      uploadRequest({
        kind: "screenshot",
        filename: "shot.png",
        body: bytes,
        pageUrl: "https://example.com/page",
        pageTitle: "Example Page"
      }),
      env
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; kind: string; status: string }
    expect(body.kind).toBe("screenshot")
    expect(body.status).toBe("ready")
    expect(body.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/i)

    // OCR + embedding were both called
    const models = aiRun.mock.calls.map((c) => c[0])
    expect(models.some((m) => String(m).includes("llava"))).toBe(true)
    expect(models.some((m) => String(m).includes("bge-base-en-v1.5"))).toBe(true)

    // List sees it
    const list = await app.fetch(
      new Request("http://x/api/captures", { headers: TOKEN_HEADERS }),
      env
    )
    expect(list.status).toBe(200)
    const listBody = (await list.json()) as {
      captures: Array<{ id: string; filename: string; sourceUrl: string | null; sourceTitle: string | null }>
    }
    expect(listBody.captures).toHaveLength(1)
    expect(listBody.captures[0]!.sourceUrl).toBe("https://example.com/page")
    expect(listBody.captures[0]!.sourceTitle).toBe("Example Page")
  })

  it("renames the capture from OCR text at ingest", async () => {
    const env = makeEnv()
    // Stub AI: OCR (llava) returns visible text; embed (bge) returns a vector;
    // the rename model (gpt-oss) returns a title.
    const aiRun = vi.fn(async (model: string, payload: unknown) => {
      if (model.includes("llava")) return { description: "Invoice ACME 2026" }
      if (model.endsWith("bge-base-en-v1.5")) {
        const texts = ((payload as { text?: string[] }).text) ?? []
        return { data: texts.map(() => Array.from({ length: EMBED_DIMS }, () => 0.01)) }
      }
      return { response: "ACME Invoice 2026" }
    })
    env.AI = { run: aiRun } as unknown as Ai
    const res = await app.fetch(
      uploadRequest({ kind: "screenshot", filename: "screenshot-123.png", body: new Uint8Array([1, 2, 3, 4]) }),
      env
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; filename: string }
    expect(body.filename).toBe("acme-invoice-2026.png")
  })

  it("keeps the row even when OCR throws — status='failed' but R2/D1 are written", async () => {
    const env = makeEnv()
    const aiRun = vi.fn(async (model: string, payload: unknown) => {
      if (model.endsWith("bge-base-en-v1.5")) {
        const texts = ((payload as { text?: string[] }).text) ?? []
        return { data: texts.map(() => Array.from({ length: EMBED_DIMS }, () => 0.5)) }
      }
      if (model.includes("llava")) throw new Error("llava 503")
      throw new Error(`unstubbed: ${model}`)
    })
    env.AI = { run: aiRun } as unknown as Ai
    const res = await app.fetch(
      uploadRequest({ kind: "screenshot", filename: "x.png", body: new Uint8Array([1, 2, 3, 4]) }),
      env
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { status: string; statusMessage: string | null }
    expect(body.status).toBe("failed")
    expect(body.statusMessage).toContain("llava 503")
  })

  it("rejects bodies larger than the 25 MB cap", async () => {
    const env = makeEnv()
    stubAi(env, "")
    const big = new Uint8Array(25 * 1024 * 1024 + 1)
    const res = await app.fetch(
      uploadRequest({ kind: "pdf", filename: "big.pdf", contentType: "application/pdf", body: big }),
      env
    )
    expect(res.status).toBe(413)
  })

  it("DELETE removes the row, R2 object, and Vectorize entries", async () => {
    const env = makeEnv()
    stubAi(env, "hello")
    const bytes = new Uint8Array([1, 2, 3])
    const res = await app.fetch(
      uploadRequest({ kind: "screenshot", filename: "x.png", body: bytes }),
      env
    )
    const { id } = (await res.json()) as { id: string }
    const del = await app.fetch(
      new Request(`http://x/api/captures/${id}`, { method: "DELETE", headers: TOKEN_HEADERS }),
      env
    )
    expect(del.status).toBe(204)
    expect((env.VECTORS.deleteByIds as unknown as { mock: { calls: unknown[][] } }).mock.calls.length).toBeGreaterThan(
      0
    )
    const get = await app.fetch(
      new Request(`http://x/api/captures/${id}`, { headers: TOKEN_HEADERS }),
      env
    )
    expect(get.status).toBe(404)
  })

  it("GET /:id/blob returns the stored bytes with the right content-type", async () => {
    const env = makeEnv()
    stubAi(env, "x")
    const bytes = new Uint8Array([10, 20, 30, 40])
    const post = await app.fetch(
      uploadRequest({ kind: "screenshot", filename: "x.png", body: bytes }),
      env
    )
    const { id } = (await post.json()) as { id: string }
    const blob = await app.fetch(
      new Request(`http://x/api/captures/${id}/blob`, { headers: TOKEN_HEADERS }),
      env
    )
    expect(blob.status).toBe(200)
    expect(blob.headers.get("content-type")).toBe("image/png")
    expect(blob.headers.get("content-disposition")).toContain("x.png")
    const got = new Uint8Array(await blob.arrayBuffer())
    expect(got).toEqual(bytes)
  })

  it("GET /search runs the Vectorize query and joins with capture rows", async () => {
    const env = makeEnv()
    stubAi(env, "lots of helpful visible text")
    const bytes = new Uint8Array([1, 2, 3, 4])
    const post = await app.fetch(
      uploadRequest({ kind: "screenshot", filename: "x.png", body: bytes, pageTitle: "Hello" }),
      env
    )
    expect(post.status).toBe(201)
    const out = await app.fetch(
      new Request("http://x/api/captures/search?q=hello", { headers: TOKEN_HEADERS }),
      env
    )
    expect(out.status).toBe(200)
    const body = (await out.json()) as {
      q: string
      hits: Array<{ id: string; kind: string; filename: string }>
    }
    expect(body.q).toBe("hello")
    expect(body.hits.length).toBeGreaterThan(0)
    expect(body.hits[0]!.kind).toBe("screenshot")
  })

  it("rejects requests without the sidebar token", async () => {
    const env = makeEnv()
    const res = await app.fetch(
      new Request("http://x/api/captures", {
        method: "POST",
        headers: { "X-Capture-Kind": "screenshot", "X-Capture-Filename": "x.png", "content-type": "image/png" },
        body: new Uint8Array([1])
      }),
      env
    )
    expect(res.status).toBe(401)
  })
})
