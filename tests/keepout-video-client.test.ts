import { afterEach, describe, expect, it, vi } from "vitest";
import { beginFreshKeepoutVideoUpload } from "../src/lib/keepout-video-client";

const connection = { port: 8721, token: "session-token" };
const input = {
  id: "00000000-0000-4000-8000-000000000001",
  captureID: "00000000-0000-4000-8000-000000000002",
  title: "Lecture",
  contentType: "video/mp4",
};

describe("Keepout video upload sessions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes a partial strict-index upload before replaying a stream from chunk zero", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: input.id, chunkBytes: 1_048_576, uploadNonce: "00000000-0000-4000-8000-000000000003", index: 3 }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: input.id }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: input.id, chunkBytes: 1_048_576, uploadNonce: "00000000-0000-4000-8000-000000000004", index: 0 }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(beginFreshKeepoutVideoUpload(connection, input)).resolves.toMatchObject({ id: input.id, nextIndex: 0 });
    expect(fetchMock.mock.calls[1][0]).toBe(`http://127.0.0.1:8721/v1/page-videos/${input.id}`);
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "DELETE", headers: expect.objectContaining({ "X-Keepout-Upload": "00000000-0000-4000-8000-000000000003" }) }));
  });

  it("accepts an idempotent completed session without a nonce", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: input.id, chunkBytes: 1_048_576, complete: true }), { status: 201 })));
    await expect(beginFreshKeepoutVideoUpload(connection, input)).resolves.toMatchObject({ complete: true, nextIndex: 0 });
  });
});
