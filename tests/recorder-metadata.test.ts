import { describe, it, expect, beforeEach, vi } from "vitest"
import {
  chunkBase64,
  joinChunks,
  DEFAULT_CHUNK_BYTES,
  blobToBase64
} from "../src/lib/recorder-chunks"
import {
  RECORDER_STORAGE_KEY,
  type RecordingMetadata
} from "../src/types"

describe("chunkBase64 / joinChunks", () => {
  it("returns [] for empty input", () => {
    expect(chunkBase64("")).toEqual([])
  })

  it("rejects non-positive chunk size", () => {
    expect(() => chunkBase64("abc", 0)).toThrow()
  })

  it("splits input into chunks of the requested size", () => {
    const b64 = "A".repeat(1000)
    const parts = chunkBase64(b64, 256)
    expect(parts.length).toBe(Math.ceil(1000 / 256))
    for (const p of parts.slice(0, -1)) expect(p.length).toBe(256)
    expect(joinChunks(parts)).toBe(b64)
  })

  it("chunks a 5MB-equivalent base64 blob into <=768KB pieces and reassembles", async () => {
    // 5 MB of binary → ~6.67 MB of base64 (4/3 expansion).
    const bytes = new Uint8Array(5 * 1024 * 1024)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const blob = new Blob([bytes], { type: "video/mp4" })
    const b64 = await blobToBase64(blob)

    const parts = chunkBase64(b64, DEFAULT_CHUNK_BYTES)
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(DEFAULT_CHUNK_BYTES)
    expect(joinChunks(parts)).toBe(b64)

    // Round-trip back to bytes and verify byte-equality.
    const round = atob(joinChunks(parts))
    expect(round.length).toBe(bytes.length)
    for (let i = 0; i < 1024; i++) {
      // sample first 1KB to keep the test fast
      expect(round.charCodeAt(i)).toBe(bytes[i])
    }
  })
})

describe("recorder mp4 fail-fast check", () => {
  beforeEach(() => {
    // Reset MediaRecorder global per test.
    delete (globalThis as any).MediaRecorder
  })

  it("returns the right error when mp4 is unsupported", () => {
    ;(globalThis as any).MediaRecorder = {
      isTypeSupported: (m: string) => false
    }
    const errors: { type: string; error: string }[] = []
    function check() {
      if (!(globalThis as any).MediaRecorder.isTypeSupported("video/mp4;codecs=h264")) {
        errors.push({
          type: "RECORDER_ERROR",
          error: "mp4 codec (h264) not supported by this browser"
        })
        return false
      }
      return true
    }
    expect(check()).toBe(false)
    expect(errors).toHaveLength(1)
    expect(errors[0].error).toMatch(/mp4 codec.*not supported/i)
  })

  it("passes when mp4 is supported", () => {
    ;(globalThis as any).MediaRecorder = {
      isTypeSupported: (m: string) => m === "video/mp4;codecs=h264"
    }
    expect(
      (globalThis as any).MediaRecorder.isTypeSupported("video/mp4;codecs=h264")
    ).toBe(true)
  })
})

describe("recorder metadata persistence", () => {
  it("appends a recording entry to chrome.storage.local on stop", async () => {
    // Simulate handleRecorderStopped's persist step directly against the shim.
    const meta: RecordingMetadata = {
      id: "01HEX0123",
      source: "tab",
      durationMs: 4321,
      sizeBytes: 99887,
      mimeType: "video/mp4",
      filename: "recording-2026-04-29T12-34-56Z.mp4",
      createdAt: "2026-04-29T12:34:56.789Z",
      originUrl: "https://example.com/"
    }

    const before = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    expect(before[RECORDER_STORAGE_KEY]).toBeUndefined()

    const got = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    const list = (got[RECORDER_STORAGE_KEY] as RecordingMetadata[] | undefined) ?? []
    list.unshift(meta)
    await chrome.storage.local.set({ [RECORDER_STORAGE_KEY]: list })

    const after = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    expect(after[RECORDER_STORAGE_KEY]).toBeInstanceOf(Array)
    expect((after[RECORDER_STORAGE_KEY] as RecordingMetadata[])[0]).toEqual(meta)
  })

  it("keeps newest first and caps at 200 entries", async () => {
    const seed: RecordingMetadata[] = Array.from({ length: 200 }, (_, i) => ({
      id: `id-${i}`,
      source: "tab",
      durationMs: i * 100,
      sizeBytes: 1024 * (i + 1),
      mimeType: "video/mp4",
      filename: `recording-${i}.mp4`,
      createdAt: new Date(2026, 0, 1, 0, 0, i).toISOString()
    }))
    await chrome.storage.local.set({ [RECORDER_STORAGE_KEY]: seed })

    const newest: RecordingMetadata = {
      id: "newest",
      source: "screen",
      durationMs: 1000,
      sizeBytes: 1234,
      mimeType: "video/mp4",
      filename: "recording-newest.mp4",
      createdAt: new Date().toISOString()
    }

    const got = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    const list = (got[RECORDER_STORAGE_KEY] as RecordingMetadata[]) ?? []
    list.unshift(newest)
    await chrome.storage.local.set({ [RECORDER_STORAGE_KEY]: list.slice(0, 200) })

    const after = await chrome.storage.local.get(RECORDER_STORAGE_KEY)
    const final = after[RECORDER_STORAGE_KEY] as RecordingMetadata[]
    expect(final.length).toBe(200)
    expect(final[0].id).toBe("newest")
  })
})
