import { describe, expect, it } from "vitest";
import { decodeCanvasVideoChunk } from "../src/lib/canvas-video-import";

describe("Canvas video isolated-world chunk bridge", () => {
  it("decodes a bounded JSON-safe base64 chunk", () => {
    expect([...decodeCanvasVideoChunk("AAEC/w==", 4)]).toEqual([0, 1, 2, 255]);
  });

  it.each(["", "not base64!", "AAEC/w==extra", "AAAAAAA="])("rejects malformed or oversized wire chunks", (value) => {
    expect(() => decodeCanvasVideoChunk(value, 4)).toThrow("Invalid video chunk");
  });
});
