import { describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import { putBlob, getBlob, deleteBlob, keyFor } from "../src/r2"

describe("r2", () => {
  it("keyFor namespaces recordings and pdfs", () => {
    expect(keyFor("recording", "abc", "mp4")).toBe("recordings/abc.mp4")
    expect(keyFor("recording", "abc", ".MOV")).toBe("recordings/abc.mov")
    expect(keyFor("pdf", "xyz", "pdf")).toBe("pdfs/xyz.pdf")
  })

  it("putBlob then getBlob round-trips bytes and content-type", async () => {
    const env = makeEnv()
    const data = new TextEncoder().encode("hello world")
    await putBlob(env, "recordings/r1.mp4", data, { contentType: "video/mp4", size: data.byteLength })
    const got = await getBlob(env, "recordings/r1.mp4")
    expect(got).not.toBeNull()
    expect(got!.httpMetadata?.contentType).toBe("video/mp4")
    expect(new TextDecoder().decode(await got!.arrayBuffer())).toBe("hello world")
  })

  it("getBlob returns null for missing keys", async () => {
    const env = makeEnv()
    expect(await getBlob(env, "nope")).toBeNull()
  })

  it("deleteBlob removes the object", async () => {
    const env = makeEnv()
    await putBlob(env, "k", new Uint8Array([1, 2, 3]), { contentType: "application/octet-stream" })
    await deleteBlob(env, "k")
    expect(await getBlob(env, "k")).toBeNull()
  })
})
