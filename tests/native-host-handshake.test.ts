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

  it("surfaces failed terminal native sends as pty errors instead of silent spinner states", () => {
    const backgroundSource = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8",
    );
    const hookSource = readFileSync(
      join(process.cwd(), "src/hooks/useNativeHost.ts"),
      "utf8",
    );
    const terminalSource = readFileSync(
      join(process.cwd(), "src/sections/terminal/TerminalSection.tsx"),
      "utf8",
    );

    expect(backgroundSource).toContain("function nativeSendFailurePayload");
    expect(backgroundSource).toContain('msg.type.startsWith("pty.")');
    expect(backgroundSource).toContain('type: "pty.error"');
    expect(backgroundSource).toContain("if (port && postToNative(port, msg)) return;");
    expect(hookSource).toContain("reportLocalSendFailure");
    expect(hookSource).toContain("return false");
    expect(hookSource).toContain('return send({ type: "pty.spawn"');
    expect(terminalSource).toContain("const SPAWN_TIMEOUT_MS");
    expect(terminalSource).toContain("spawn timed out");
    expect(terminalSource).toContain("pendingData");
  });

  it("lets interactive native requests bypass a pending background reconnect", () => {
    const backgroundSource = readFileSync(
      join(process.cwd(), "src/background.ts"),
      "utf8",
    );

    expect(backgroundSource).toContain(
      "function connectNativeHost({ force = false }",
    );
    expect(backgroundSource).toContain(
      "if (force && reconnectTimer !== null)",
    );
    expect(backgroundSource).toContain(
      "const port = connectNativeHost({ force: true });",
    );
  });

  it("waits for MCP startup before reporting status from the native host", () => {
    const hostSource = readFileSync(
      join(process.cwd(), "native-host/ai-dev-host.mjs"),
      "utf8",
    );

    expect(hostSource).toContain("const mcpReady = mcp.start()");
    expect(hostSource).toContain("async function waitForMcpReady()");
    expect(hostSource).toContain("function sendMcpStatus(configPath");
    expect(hostSource).toContain('case "mcp.status"');
    expect(hostSource).toContain('case "mcp.ensure"');
    expect(hostSource).toContain("mcp.getStatus(configPath)");
    expect(hostSource).toContain("mcp.ensureRegistered(configPath)");
    expect(hostSource).toContain("msg.configPath");
    expect(hostSource).toContain("await waitForMcpReady()");
    expect(hostSource).toContain("sendMcpStatus(msg.configPath");
  });

  it("does not block pty.spawn on MCP startup", () => {
    const hostSource = readFileSync(
      join(process.cwd(), "native-host/ai-dev-host.mjs"),
      "utf8",
    );
    const spawnStart = hostSource.indexOf('case "pty.spawn"');
    const spawnEnd = hostSource.indexOf('case "pty.write"', spawnStart);
    const spawnCase = hostSource.slice(spawnStart, spawnEnd);

    expect(spawnCase).toContain("mcpPtyEnvIfReady()");
    expect(spawnCase).toContain("await ptyManager.spawn(merged)");
    expect(spawnCase).not.toContain("waitForMcpReady");
  });
});
