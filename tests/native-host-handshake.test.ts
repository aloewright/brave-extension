import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("native host sidepanel handshake", () => {
  it("forwards pong responses so useNativeHost can mark the terminal connected", () => {
    const backgroundSource = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8",
    );
    const hookSource = readFileSync(
      join(process.cwd(), "src/hooks/useNativeHost.ts"),
      "utf8",
    );

    expect(hookSource).toContain('payload: { type: "ping" }');
    expect(hookSource).toContain("setConnected(true)");
    expect(backgroundSource).not.toContain('if (msg?.type === "pong") return');
  });

  it("guards background port writes so close/reopen races do not throw from the generated bundle", () => {
    const backgroundSource = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8",
    );

    expect(backgroundSource).toContain("function postToSidebar");
    expect(backgroundSource).toContain("function postToNative");
    expect(backgroundSource).toContain('safeRuntimeWarning("failed to post message to sidebar port"');
    expect(backgroundSource).toContain('safeRuntimeWarning("failed to post message to native host"');
    expect(backgroundSource).toContain("postToNative(port, { type: \"ping\" })");
    expect(backgroundSource).not.toContain('port.postMessage({ type: "native-response"');
    expect(backgroundSource).not.toContain('port.postMessage({ type: "mcp.tool.result"');
  });

  it("waits for MCP startup before reporting status from the native host", () => {
    const hostSource = readFileSync(
      join(process.cwd(), "native-host/ai-dev-host.mjs"),
      "utf8",
    );

    expect(hostSource).toContain("const mcpReady = mcp.start()");
    expect(hostSource).toContain("async function waitForMcpReady()");
    expect(hostSource).toContain("function sendMcpStatus()");
    expect(hostSource).toContain('case "mcp.status"');
    expect(hostSource).toContain("await waitForMcpReady()");
    expect(hostSource).toContain("sendMcpStatus()");
  });
});
