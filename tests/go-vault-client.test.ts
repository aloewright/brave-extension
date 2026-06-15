import { afterEach, describe, expect, it, vi } from "vitest";
import {
  checkGoVaultBridge,
  fetchGoExtensionSessionStatus,
  fetchGoExtensionStatus,
} from "../src/lib/go-vault-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("go vault bridge client", () => {
  it("reads the public extension bridge without browser credentials", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        object: "go-extension-status",
        ok: true,
        checkedAt: "2026-06-14T12:00:00.000Z",
        version: "2026.4.1",
        jwtUnsafeReason: null,
        jwtSecretMinLength: 32,
        registrationInviteRequired: true,
        bridgeVersion: 1,
        storagePolicy: {
          extensionStoresVaultPasswords: false,
          decryptedSecretsStoredByExtension: false,
          passiveAutofillEnabled: false,
        },
        capabilities: {
          vault: true,
          imports: true,
          backups: true,
          devices: true,
          settings: true,
          extensionReadOnlyStatus: true,
        },
        routes: {
          vault: "/vault",
          importExport: "/backup/import-export",
          backups: "/backup",
          devices: "/security/devices",
          settings: "/settings",
          login: "/login",
        },
        apiRoutes: {
          status: "/api/extension/status",
          session: "/api/extension/session",
          backupStatus: "/api/extension/backup/status",
          importStatus: "/api/extension/import/status",
          deviceStatus: "/api/extension/devices/status",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const status = await fetchGoExtensionStatus("https://go.lazee.workers.dev/");

    expect(status.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://go.lazee.workers.dev/api/extension/status",
      expect.objectContaining({
        cache: "no-store",
        credentials: "omit",
      }),
    );
  });

  it("does not call authenticated bridge routes without an explicit bearer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchGoExtensionSessionStatus("https://go.lazee.workers.dev"),
    ).resolves.toMatchObject({
      state: "not_linked",
      user: null,
      capabilities: {
        canOpenVault: false,
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to legacy status probes until the bridge is deployed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("not found", { status: 404 }))
      .mockResolvedValueOnce(jsonResponse({
        jwtUnsafeReason: null,
        registrationInviteRequired: true,
      }))
      .mockResolvedValueOnce(jsonResponse("2026.4.1"));
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await checkGoVaultBridge("https://go.lazee.workers.dev");

    expect(snapshot.publicStatus).toBeNull();
    expect(snapshot.status).toMatchObject({
      ok: true,
      version: "2026.4.1",
      registrationInviteRequired: true,
    });
    expect(snapshot.session.state).toBe("not_linked");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes("/api/extension/session"),
      ),
    ).toBe(false);
  });
});
