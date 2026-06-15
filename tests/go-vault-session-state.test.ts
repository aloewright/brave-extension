import { describe, expect, it } from "vitest";
import {
  GO_VAULT_SESSION_STATUS_STORAGE_KEY,
  readGoVaultBrowserSessionStatus,
  sanitizeGoVaultBrowserSessionStatus,
  saveGoVaultBrowserSessionStatus,
} from "../src/lib/go-vault-session-state";

function collectKeys(value: unknown, keys = new Set<string>()): Set<string> {
  if (!value || typeof value !== "object") return keys;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, keys);
    return keys;
  }
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

describe("go vault browser session state", () => {
  it("sanitizes a go session pulse before extension storage", async () => {
    const status = sanitizeGoVaultBrowserSessionStatus(
      {
        object: "go-vault-browser-session",
        version: 1,
        origin: "https://go.lazee.workers.dev/vault",
        state: "unlocked",
        email: " aloe@fly.pm ",
        role: "admin",
        route: "/vault",
        checkedAt: "2026-06-14T12:00:00.000Z",
        accessToken: "secret-token",
        refreshToken: "secret-refresh",
        password: "master-password",
        cipher: { login: { password: "vault-password" } },
        key: "vault-key",
        webdavPassword: "dav-secret",
      },
      "https://go.lazee.workers.dev",
    );

    expect(status).toEqual({
      object: "go-vault-browser-session",
      version: 1,
      origin: "https://go.lazee.workers.dev",
      state: "unlocked",
      email: "aloe@fly.pm",
      role: "admin",
      route: "/vault",
      checkedAt: "2026-06-14T12:00:00.000Z",
    });

    await saveGoVaultBrowserSessionStatus(status!);
    const stored = await chrome.storage.local.get(GO_VAULT_SESSION_STATUS_STORAGE_KEY);
    const serialized = JSON.stringify(stored);

    for (const secret of [
      "secret-token",
      "secret-refresh",
      "master-password",
      "vault-password",
      "vault-key",
      "dav-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }

    const keys = collectKeys(stored);
    for (const forbiddenKey of [
      "accessToken",
      "refreshToken",
      "password",
      "cipher",
      "key",
      "webdavPassword",
    ]) {
      expect(keys.has(forbiddenKey)).toBe(false);
    }
  });

  it("rejects non-go origins and stale configured origins", async () => {
    expect(
      sanitizeGoVaultBrowserSessionStatus({
        object: "go-vault-browser-session",
        version: 1,
        origin: "https://evil.example",
        state: "unlocked",
        checkedAt: "2026-06-14T12:00:00.000Z",
      }),
    ).toBeNull();

    await chrome.storage.local.set({
      [GO_VAULT_SESSION_STATUS_STORAGE_KEY]: {
        object: "go-vault-browser-session",
        version: 1,
        origin: "https://go.lazee.workers.dev",
        state: "locked",
        email: "aloe@fly.pm",
        role: "admin",
        route: "/lock",
        checkedAt: "2026-06-14T12:00:00.000Z",
      },
    });

    await expect(
      readGoVaultBrowserSessionStatus("https://other.example"),
    ).resolves.toBeNull();
  });
});
