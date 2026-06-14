import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("extension page privacy", () => {
  it("does not expose extension resources or external web access in the manifest", () => {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), "package.json"), "utf8"),
    );

    expect(packageJson.manifest.web_accessible_resources).toBeUndefined();
    expect(packageJson.manifest.externally_connectable).toBeUndefined();
  });

  it("returns no extension data to external runtime callers", () => {
    const source = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8",
    );

    expect(source).toContain("onMessageExternal");
    expect(source).toContain("sendResponse(undefined)");
    expect(source).toContain("onConnectExternal");
    expect(source).not.toContain("onMessageExternal.addListener((message");
  });

});
