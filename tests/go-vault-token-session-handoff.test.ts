import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GO_VAULT_AUTHENTICATED_EXTENSION_BRIDGE_ENABLED } from "../src/lib/go-vault-client";

function readWorkspaceFile(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("go token/session handoff boundary", () => {
  it("records the selected handoff decision and reviewed options", () => {
    const doc = readWorkspaceFile("docs/go-token-session-handoff.md");

    expect(doc).toContain("Decision: no token handoff in the current extension phase");
    expect(doc).toContain("No token handoff");
    expect(doc).toContain("One-time short-lived capability token");
    expect(doc).toContain("Extension-origin bound session check");
    expect(doc).toContain("Open-go-only route launching");
    expect(doc).toContain("`chrome.storage.session` is not an exception");
    expect(doc).toContain("Cloudflare Access gates the deployed `go` worker");

    expect(readWorkspaceFile("docs/password-strategy.md")).toContain(
      "go-token-session-handoff.md",
    );
    expect(readWorkspaceFile("docs/password-next-phase-swarm-plan.md")).toContain(
      "go-token-session-handoff.md",
    );
  });

  it("keeps authenticated extension bridge calls disabled", () => {
    const client = readWorkspaceFile("src/lib/go-vault-client.ts");

    expect(GO_VAULT_AUTHENTICATED_EXTENSION_BRIDGE_ENABLED).toBe(false);
    expect(client).toContain('credentials: "omit"');
    expect(client).not.toMatch(/credentials:\s*["']include["']/);
    expect(client).not.toMatch(/Authorization\s*:/);
    expect(client).not.toMatch(/Bearer\s+\$\{/);
  });

  it("does not persist go credentials in extension-side storage paths", () => {
    const files = [
      "src/lib/go-vault-client.ts",
      "src/lib/go-vault-session-state.ts",
      "src/contents/go-vault-session.ts",
      "src/sections/passwords/PasswordVaultSection.tsx",
    ];

    for (const file of files) {
      const source = readWorkspaceFile(file);

      expect(source, file).not.toMatch(/chrome\.storage\.session/);
      expect(source, file).not.toMatch(/passwords\.go\.[^"']*(token|secret|credential|bearer|jwt)/i);
      expect(source, file).not.toMatch(/\b(accessToken|refreshToken)\b/);
    }
  });

  it("keeps the sidebar bearer provider intentionally empty", () => {
    const section = readWorkspaceFile("src/sections/passwords/PasswordVaultSection.tsx");

    expect(section).toMatch(
      /function getGoVaultBridgeBearer\(\): string \| null \{\s*\/\/ See docs\/go-token-session-handoff\.md:[\s\S]*?return null;\s*\}/,
    );
  });
});
