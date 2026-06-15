import { describe, expect, it, vi } from "vitest";
import {
  buildExtensionBackupStatus,
  buildExtensionDeviceStatus,
  buildExtensionImportStatus,
  buildExtensionPublicStatus,
  type ExtensionBackupStatusResponse,
  type ExtensionDeviceStatusResponse,
} from "../password-app/src/extension-bridge-contract";
import type { Env } from "../password-app/src/types";

// handlePublicExtensionStatus transitively imports notifications-hub which
// uses the 'cloudflare:workers' runtime module unavailable in vitest. Mock the
// durable module so the handler can be imported without a real CF environment.
vi.mock("../password-app/src/durable/notifications-hub", () => ({
  getOnlineUserDevices: vi.fn().mockResolvedValue([]),
}));

// Imported after vi.mock so the mock is in effect when the module loads.
const { handlePublicExtensionStatus } = await import(
  "../password-app/src/handlers/extension-bridge"
);

// Minimal D1Database stub — only implements the query used by getUserCount().
function makeStubDb(userCount: number): D1Database {
  return {
    prepare: () => ({
      first: async () => ({ count: userCount }),
    }),
  } as unknown as D1Database;
}

function makeStubEnv(overrides: Partial<Env> = {}): Env {
  return {
    JWT_SECRET: "stub-jwt-secret-that-must-never-leak-in-response",
    BOOTSTRAP_INVITE_CODE: "stub-invite-code-that-must-never-leak",
    DB: makeStubDb(0),
    NOTIFICATIONS_HUB: {} as DurableObjectNamespace,
    BACKUP_TRANSFER_RUNNER: {} as DurableObjectNamespace,
    ...overrides,
  } as Env;
}

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

describe("go extension bridge contract", () => {
  it("keeps public status free of credential-shaped fields and values", () => {
    const response = buildExtensionPublicStatus({
      version: "2026.6.15",
      jwtUnsafeReason: null,
      jwtSecretMinLength: 32,
      registrationInviteRequired: true,
    });

    const serialized = JSON.stringify(response);
    for (const forbiddenValue of [
      "webdav-passphrase",
      "r2-secret-key",
      "master-password",
      "refresh-token",
      "cipher-payload",
    ]) {
      expect(serialized).not.toContain(forbiddenValue);
    }

    const keys = collectKeys(response);
    const publicStatusAllowlist = new Set([
      "extensionStoresVaultPasswords",
      "decryptedSecretsStoredByExtension",
      "jwtSecretMinLength",
    ]);
    const forbiddenKeyShape =
      /(access.*token|refresh.*token|password|passphrase|cipher|credential|webdav|access.*key|secret.*key|private.*key|master.*key|^key$|destination|username|bucket|rootPath)/i;
    expect(
      [...keys].filter(
        (key) =>
          !publicStatusAllowlist.has(key) && forbiddenKeyShape.test(key),
      ),
    ).toEqual([]);
  });

  it("represents backup reactivation as a renderable state", () => {
    expect(buildExtensionBackupStatus(null, "needs_reactivation")).toMatchObject({
      object: "go-extension-backup-status",
      state: "needs_reactivation",
      directBackupFromExtension: false,
      route: "/backup",
      destinations: [],
      summary: {
        destinationCount: 0,
      },
    });
  });

  it("sanitizes backup settings before returning them to the extension", () => {
    const response: ExtensionBackupStatusResponse = buildExtensionBackupStatus({
      destinations: [
        {
          id: "dest-webdav",
          name: "Remote backup",
          type: "webdav",
          includeAttachments: true,
          destination: {
            baseUrl: "https://dav.example/private",
            username: "alice-webdav",
            password: "webdav-passphrase",
            remotePath: "private/vault/backups",
          },
          schedule: {
            enabled: true,
            intervalHours: 24,
            startTime: "03:00",
            timezone: "America/Los_Angeles",
            retentionCount: 7,
          },
          runtime: {
            lastAttemptAt: "2026-06-14T10:00:00.000Z",
            lastAttemptLocalDate: "2026-06-14",
            lastSuccessAt: "2026-06-14T10:00:00.000Z",
            lastErrorAt: null,
            lastErrorMessage: null,
            lastUploadedFileName: "nodewarden-2026-06-14.zip",
            lastUploadedSizeBytes: 1234,
            lastUploadedDestination: "https://dav.example/private/private/vault/backups",
          },
        },
        {
          id: "dest-s3",
          name: "Object backup",
          type: "s3",
          includeAttachments: false,
          destination: {
            endpoint: "https://r2.example",
            bucket: "secret-vault-bucket",
            region: "auto",
            accessKeyId: "r2-access-id",
            secretAccessKey: "r2-secret-key",
            rootPath: "private/root",
          },
          schedule: {
            enabled: false,
            intervalHours: 12,
            startTime: "04:30",
            timezone: "UTC",
            retentionCount: null,
          },
          runtime: {
            lastAttemptAt: "2026-06-13T10:00:00.000Z",
            lastAttemptLocalDate: "2026-06-13",
            lastSuccessAt: null,
            lastErrorAt: "2026-06-13T10:01:00.000Z",
            lastErrorMessage: "failed for https://r2.example/private/root",
            lastUploadedFileName: null,
            lastUploadedSizeBytes: null,
            lastUploadedDestination: null,
          },
        },
      ],
    });

    const serialized = JSON.stringify(response);
    for (const secretValue of [
      "https://dav.example/private",
      "alice-webdav",
      "webdav-passphrase",
      "private/vault/backups",
      "https://r2.example",
      "secret-vault-bucket",
      "r2-access-id",
      "r2-secret-key",
      "private/root",
    ]) {
      expect(serialized).not.toContain(secretValue);
    }

    const keys = collectKeys(response);
    for (const forbiddenKey of [
      "destination",
      "baseUrl",
      "username",
      "password",
      "remotePath",
      "endpoint",
      "bucket",
      "accessKeyId",
      "secretAccessKey",
      "rootPath",
      "lastErrorMessage",
      "lastUploadedDestination",
    ]) {
      expect(keys.has(forbiddenKey)).toBe(false);
    }

    expect(response.summary).toMatchObject({
      destinationCount: 2,
      configuredDestinationCount: 2,
      scheduledDestinationCount: 1,
    });
    expect(response.directBackupFromExtension).toBe(false);
    expect(response.route).toBe("/backup");
    expect(response.destinations[1].runtime.lastErrorSummary).toBe(
      "Backup failed. Open go for details.",
    );
  });

  it("keeps import/export readiness route-only from the extension", () => {
    const response = buildExtensionImportStatus("available");

    expect(response).toMatchObject({
      object: "go-extension-import-status",
      state: "available",
      directImportFromExtension: false,
      route: "/backup/import-export",
    });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("cipher");
    expect(serialized).not.toContain("vault-password");
    expect(serialized).not.toContain("backup-archive-bytes");
  });

  // --- Handler-level tests (test the HTTP layer, not just the builder) ---

  it("does not include the raw JWT_SECRET value in the /api/extension/status HTTP response", async () => {
    const env = makeStubEnv({
      JWT_SECRET: "stub-jwt-secret-that-must-never-leak-in-response",
    });
    const response = await handlePublicExtensionStatus(env);
    const body = await response.text();
    expect(body).not.toContain("stub-jwt-secret-that-must-never-leak-in-response");
  });

  it("does not include the raw BOOTSTRAP_INVITE_CODE value in the /api/extension/status HTTP response", async () => {
    const env = makeStubEnv({
      BOOTSTRAP_INVITE_CODE: "stub-invite-code-that-must-never-leak",
    });
    const response = await handlePublicExtensionStatus(env);
    const body = await response.text();
    expect(body).not.toContain("stub-invite-code-that-must-never-leak");
  });

  it("public status HTTP response contains only the documented top-level keys", async () => {
    const response = await handlePublicExtensionStatus(makeStubEnv());
    const body = await response.json() as Record<string, unknown>;

    const EXPECTED_TOP_LEVEL_KEYS = new Set([
      "object",
      "ok",
      "checkedAt",
      "version",
      "jwtUnsafeReason",
      "jwtSecretMinLength",
      "registrationInviteRequired",
      "bridgeVersion",
      "storagePolicy",
      "capabilities",
      "routes",
      "apiRoutes",
    ]);

    const actualKeys = new Set(Object.keys(body));
    const unexpected = [...actualKeys].filter((k) => !EXPECTED_TOP_LEVEL_KEYS.has(k));
    expect(unexpected).toEqual([]);
  });

  it("public status HTTP response returns 200 with application/json content-type", async () => {
    const response = await handlePublicExtensionStatus(makeStubEnv());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("application/json");
  });

  // --- Authenticated builder tests ---

  it("sanitizes device readiness before returning it to the extension", () => {
    const response: ExtensionDeviceStatusResponse = buildExtensionDeviceStatus({
      currentDeviceIdentifier: "device-id-secret",
      onlineDeviceIdentifiers: ["device-id-secret", "other-device-secret"],
      trustedDeviceTokenSummaries: [
        {
          deviceIdentifier: "device-id-secret",
          expiresAt: Date.parse("2026-06-16T00:00:00.000Z"),
          tokenCount: 2,
        },
      ],
      devices: [
        {
          userId: "user-secret",
          deviceIdentifier: "device-id-secret",
          name: "Aloe MacBook",
          deviceNote: "private note",
          type: 14,
          sessionStamp: "session-stamp-secret",
          encryptedUserKey: "encrypted-user-key-secret",
          encryptedPublicKey: "encrypted-public-key-secret",
          encryptedPrivateKey: "encrypted-private-key-secret",
          devicePendingAuthRequest: {
            id: "pending-auth-secret",
            creationDate: "2026-06-15T00:00:00.000Z",
          },
          lastSeenAt: "2026-06-15T01:00:00.000Z",
          createdAt: "2026-06-14T01:00:00.000Z",
          updatedAt: "2026-06-15T01:00:00.000Z",
        },
      ],
    });

    expect(response).toMatchObject({
      object: "go-extension-device-status",
      state: "available",
      directDeviceManagementFromExtension: false,
      route: "/security/devices",
      summary: {
        knownDeviceCount: 1,
        trustedDeviceCount: 1,
        onlineDeviceCount: 1,
        pendingAuthRequestCount: 1,
        currentDeviceKnown: true,
        currentDeviceTrusted: true,
      },
    });

    const serialized = JSON.stringify(response);
    for (const secretValue of [
      "device-id-secret",
      "other-device-secret",
      "user-secret",
      "session-stamp-secret",
      "encrypted-user-key-secret",
      "encrypted-public-key-secret",
      "encrypted-private-key-secret",
      "pending-auth-secret",
      "private note",
    ]) {
      expect(serialized).not.toContain(secretValue);
    }

    const keys = collectKeys(response);
    for (const forbiddenKey of [
      "deviceIdentifier",
      "identifier",
      "userId",
      "sessionStamp",
      "encryptedUserKey",
      "encryptedPublicKey",
      "encryptedPrivateKey",
      "devicePendingAuthRequest",
      "trustedDeviceTokenSummaries",
      "tokenCount",
      "devices",
      "onlineDeviceIdentifiers",
    ]) {
      expect(keys.has(forbiddenKey)).toBe(false);
    }
  });
});
