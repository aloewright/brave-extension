import { describe, expect, it } from "vitest";
import {
  buildExtensionBackupStatus,
  buildExtensionDeviceReadiness,
  buildExtensionImportStatus,
  buildExtensionPublicStatus,
  type ExtensionBackupStatusResponse,
} from "../password-app/src/extension-bridge-contract";

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
    expect(response.destinations[1].runtime.lastErrorSummary).toBe(
      "Backup failed. Open go for details.",
    );
  });

  it("import status carries no credential-shaped fields and blocks direct cipher access", () => {
    const response = buildExtensionImportStatus("available");

    expect(response.directImportFromExtension).toBe(false);
    expect(response.route).toBe("/backup/import-export");

    const serialized = JSON.stringify(response);
    for (const forbiddenValue of [
      "cipher",
      "password",
      "token",
      "secret",
      "key",
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbiddenValue);
    }

    const keys = collectKeys(response);
    const forbiddenKeyShape =
      /(cipher|password|token|secret|^key$|credential|accessKey|privateKey)/i;
    expect(
      [...keys].filter((key) => forbiddenKeyShape.test(key)),
    ).toEqual([]);
  });

  it("device readiness carries no credential-shaped fields and blocks direct mutations", () => {
    const response = buildExtensionDeviceReadiness({
      totalDeviceCount: 3,
      trustedDeviceCount: 1,
      verifyDevicesEnabled: true,
    });

    expect(response.directDeviceMutationFromExtension).toBe(false);
    expect(response.route).toBe("/security/devices");
    expect(response.summary.totalDeviceCount).toBe(3);
    expect(response.summary.trustedDeviceCount).toBe(1);
    expect(response.summary.verifyDevicesEnabled).toBe(true);

    const serialized = JSON.stringify(response);
    for (const forbiddenValue of [
      "identifier",
      "encryptedUserKey",
      "encryptedPublicKey",
      "encryptedPrivateKey",
      "sessionStamp",
      "token",
    ]) {
      expect(serialized).not.toContain(forbiddenValue);
    }

    const keys = collectKeys(response);
    const forbiddenKeyShape =
      /(identifier|encrypted|password|token|secret|^key$|credential|privateKey|publicKey|sessionStamp)/i;
    expect(
      [...keys].filter((key) => forbiddenKeyShape.test(key)),
    ).toEqual([]);
  });

  it("device readiness not_linked state returns zero counts", () => {
    const response = buildExtensionDeviceReadiness(null, "not_linked");

    expect(response.state).toBe("not_linked");
    expect(response.summary.totalDeviceCount).toBe(0);
    expect(response.summary.trustedDeviceCount).toBe(0);
    expect(response.summary.verifyDevicesEnabled).toBe(false);
    expect(response.directDeviceMutationFromExtension).toBe(false);
  });

  it("public status exposes device status api route without credentials", () => {
    const response = buildExtensionPublicStatus({
      version: "2026.6.15",
      jwtUnsafeReason: null,
      jwtSecretMinLength: 32,
      registrationInviteRequired: false,
    });

    expect(response.apiRoutes.deviceStatus).toBe("/api/extension/device/status");

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
});
