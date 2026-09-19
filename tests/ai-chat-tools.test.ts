import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTools, captureAmbient, runTool } from "../src/lib/ai-chat-tools";

const baseChrome = (globalThis as { chrome?: unknown }).chrome as Record<string, unknown>;
const query = vi.fn();
(globalThis as { chrome?: unknown }).chrome = {
  ...baseChrome,
  tabs: { query },
};

describe("AI chat browser-context tools", () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue([{ url: "http://example.test/page", title: "Example" }]);
  });

  it("exposes only the active-tab context tool", () => {
    expect(buildTools().map((tool) => tool.name)).toEqual(["context.activeTab"]);
  });

  it("returns the active tab URL and title", async () => {
    await expect(buildTools()[0]!.execute({})).resolves.toEqual({
      ok: true,
      result: { url: "http://example.test/page", title: "Example" },
    });
  });

  it("returns nulls when no active tab exists", async () => {
    query.mockResolvedValue([]);
    await expect(buildTools()[0]!.execute({})).resolves.toEqual({
      ok: true,
      result: { url: null, title: null },
    });
  });

  it("rejects unknown tools and malformed arguments", async () => {
    await expect(runTool(buildTools(), "missing.tool", "{}")).resolves.toMatchObject({ ok: false });
    await expect(runTool(buildTools(), "context.activeTab", "{bad")).resolves.toMatchObject({ ok: false });
  });

  it("captures active-tab ambient context", async () => {
    await expect(captureAmbient()).resolves.toMatchObject({
      activeTab: { url: "http://example.test/page", title: "Example" },
    });
  });
});
