import { describe, expect, it } from "vitest";
import type { GoVaultBridgeSnapshot } from "../src/lib/go-vault-client";
import type { GoVaultBrowserSessionStatus } from "../src/lib/go-vault-session-state";
import {
  assertNoSecretsInReadiness,
  deriveGoVaultReadiness,
} from "../src/lib/go-vault-readiness";

const BASE_URL = "https://go.lazee.workers.dev";

const PUBLIC_STATUS = {
  object: "go-extension-status" as const,
  ok: true,
  checkedAt: "2026-06-15T10:00:00.000Z",
  version: "2026.4.1",
  jwtUnsafeReason: null,
  jwtSecretMinLength: 32,
  registrationInviteRequired: false,
  bridgeVersion: 1 as const,
  storagePolicy: {
    extensionStoresVaultPasswords: false as const,
    decryptedSecretsStoredByExtension: false as const,
    passiveAutofillEnabled: false as const,
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
};

const ONLINE_STATUS = {
  ok: true,
  url: BASE_URL,
  checkedAt: "2026-06-15T10:00:00.000Z",
  version: "2026.4.1",
  jwtUnsafeReason: null,
  registrationInviteRequired: false,
  error: null,
};

const OFFLINE_STATUS = {
  ok: false,
  url: BASE_URL,
  checkedAt: "2026-06-15T10:00:00.000Z",
  version: null,
  jwtUnsafeReason: null,
  registrationInviteRequired: false,
  error: "Network error",
};

const NOT_LINKED_SESSION = {
  object: "go-extension-session" as const,
  state: "not_linked" as const,
  checkedAt: "2026-06-15T10:00:00.000Z",
  user: null,
  capabilities: {
    canOpenVault: false,
    canImport: false,
    canManageBackups: false,
    canManageDevices: false,
  },
};

const AUTHENTICATED_ADMIN_SESSION = {
  object: "go-extension-session" as const,
  state: "authenticated" as const,
  checkedAt: "2026-06-15T10:00:00.000Z",
  user: {
    email: "aloe@fly.pm",
    name: null,
    role: "admin" as const,
    status: "active" as const,
  },
  capabilities: {
    canOpenVault: true,
    canImport: true,
    canManageBackups: true,
    canManageDevices: true,
  },
};

const AUTHENTICATED_USER_SESSION = {
  object: "go-extension-session" as const,
  state: "authenticated" as const,
  checkedAt: "2026-06-15T10:00:00.000Z",
  user: {
    email: "member@fly.pm",
    name: null,
    role: "user" as const,
    status: "active" as const,
  },
  capabilities: {
    canOpenVault: true,
    canImport: true,
    canManageBackups: false,
    canManageDevices: false,
  },
};

const EMPTY_BACKUP = {
  object: "go-extension-backup-status" as const,
  state: "not_linked" as const,
  checkedAt: "2026-06-15T10:00:00.000Z",
  directBackupFromExtension: false as const,
  route: "/backup",
  destinations: [],
  summary: {
    destinationCount: 0,
    configuredDestinationCount: 0,
    scheduledDestinationCount: 0,
    healthyDestinationCount: 0,
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastErrorAt: null,
  },
};

const HEALTHY_BACKUP = {
  object: "go-extension-backup-status" as const,
  state: "available" as const,
  checkedAt: "2026-06-15T10:00:00.000Z",
  directBackupFromExtension: false as const,
  route: "/backup",
  destinations: [],
  summary: {
    destinationCount: 1,
    configuredDestinationCount: 1,
    scheduledDestinationCount: 1,
    healthyDestinationCount: 1,
    lastSuccessAt: "2026-06-15T03:00:00.000Z",
    lastAttemptAt: "2026-06-15T03:00:00.000Z",
    lastErrorAt: null,
  },
};

const DEGRADED_BACKUP = {
  ...HEALTHY_BACKUP,
  summary: {
    ...HEALTHY_BACKUP.summary,
    healthyDestinationCount: 0,
    lastSuccessAt: null,
    lastErrorAt: "2026-06-14T03:00:00.000Z",
  },
};

const EMPTY_IMPORT = {
  object: "go-extension-import-status" as const,
  state: "not_linked" as const,
  checkedAt: "2026-06-15T10:00:00.000Z",
  directImportFromExtension: false as const,
  route: "/backup/import-export",
  supportedSources: [],
};

const AVAILABLE_IMPORT = {
  ...EMPTY_IMPORT,
  state: "available" as const,
  supportedSources: ["bitwarden", "keepass", "lastpass"],
};

function makeSnapshot(overrides: Partial<GoVaultBridgeSnapshot> = {}): GoVaultBridgeSnapshot {
  return {
    checkedAt: "2026-06-15T10:00:00.000Z",
    status: ONLINE_STATUS,
    publicStatus: PUBLIC_STATUS,
    session: NOT_LINKED_SESSION,
    backup: EMPTY_BACKUP,
    importExport: EMPTY_IMPORT,
    ...overrides,
  };
}

function makeBrowserSession(
  state: GoVaultBrowserSessionStatus["state"],
  role: "admin" | "user" | null = "admin",
): GoVaultBrowserSessionStatus {
  return {
    object: "go-vault-browser-session",
    version: 1,
    origin: BASE_URL,
    state,
    email: state === "signed_out" ? null : "aloe@fly.pm",
    role: state === "signed_out" ? null : role,
    route: state === "unlocked" ? "/vault" : "/login",
    checkedAt: "2026-06-15T10:00:00.000Z",
  };
}

describe("go vault readiness contract", () => {
  describe("offline state", () => {
    it("returns offline action when vault is not reachable", () => {
      const snapshot = makeSnapshot({ status: OFFLINE_STATUS, publicStatus: null });
      const state = deriveGoVaultReadiness(snapshot);
      expect(state.action).toBe("offline");
      expect(state.reachable).toBe(false);
    });

    it("falls back to /vault route when offline", () => {
      const snapshot = makeSnapshot({ status: OFFLINE_STATUS, publicStatus: null });
      const state = deriveGoVaultReadiness(snapshot);
      expect(state.vaultRoute).toBe("/vault");
    });

    it("reports no backup health when offline", () => {
      const snapshot = makeSnapshot({ status: OFFLINE_STATUS, publicStatus: null });
      const state = deriveGoVaultReadiness(snapshot);
      expect(state.backupHealthy).toBeNull();
    });
  });

  describe("configure state", () => {
    it("returns configure action when vault is reachable but bridge not deployed", () => {
      const snapshot = makeSnapshot({ publicStatus: null });
      const state = deriveGoVaultReadiness(snapshot);
      expect(state.action).toBe("configure");
      expect(state.reachable).toBe(true);
    });
  });

  describe("sign_in action", () => {
    it("routes to login when api session is not_linked", () => {
      const snapshot = makeSnapshot({ session: NOT_LINKED_SESSION });
      const state = deriveGoVaultReadiness(snapshot);
      expect(state.action).toBe("sign_in");
      expect(state.vaultRoute).toBe("/login");
    });

    it("routes to login when browser session is signed_out", () => {
      const snapshot = makeSnapshot({ session: NOT_LINKED_SESSION });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("signed_out"));
      expect(state.action).toBe("sign_in");
      expect(state.vaultRoute).toBe("/login");
    });
  });

  describe("unlock action", () => {
    it("routes to login when browser session is locked", () => {
      const snapshot = makeSnapshot({ session: AUTHENTICATED_ADMIN_SESSION });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("locked"));
      expect(state.action).toBe("unlock");
      expect(state.vaultRoute).toBe("/login");
    });
  });

  describe("open_vault action", () => {
    it("opens vault when browser session is unlocked without an API session", () => {
      const snapshot = makeSnapshot({ session: NOT_LINKED_SESSION });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      expect(state.action).toBe("open_vault");
      expect(state.vaultRoute).toBe("/vault");
      expect(state.backupHealthy).toBeNull();
      expect(state.importAvailable).toBe(false);
    });

    it("opens vault when browser session is unlocked", () => {
      const snapshot = makeSnapshot({ session: AUTHENTICATED_ADMIN_SESSION });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      expect(state.action).toBe("open_vault");
      expect(state.vaultRoute).toBe("/vault");
    });

    it("opens vault when api session is authenticated without browser session", () => {
      const snapshot = makeSnapshot({ session: AUTHENTICATED_ADMIN_SESSION });
      const state = deriveGoVaultReadiness(snapshot);
      expect(state.action).toBe("open_vault");
    });

    it("reports backup healthy when admin session and all destinations healthy", () => {
      const snapshot = makeSnapshot({
        session: AUTHENTICATED_ADMIN_SESSION,
        backup: HEALTHY_BACKUP,
      });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      expect(state.backupHealthy).toBe(true);
    });

    it("reports backup unhealthy when last error is more recent than last success", () => {
      const snapshot = makeSnapshot({
        session: AUTHENTICATED_ADMIN_SESSION,
        backup: DEGRADED_BACKUP,
      });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      expect(state.backupHealthy).toBe(false);
    });

    it("reports null backup health for non-admin users", () => {
      const snapshot = makeSnapshot({
        session: AUTHENTICATED_USER_SESSION,
        backup: HEALTHY_BACKUP,
      });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked", "user"));
      expect(state.backupHealthy).toBeNull();
    });

    it("reports import available when sources are configured", () => {
      const snapshot = makeSnapshot({
        session: AUTHENTICATED_ADMIN_SESSION,
        importExport: AVAILABLE_IMPORT,
      });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      expect(state.importAvailable).toBe(true);
    });

    it("reports import unavailable when no supported sources", () => {
      const snapshot = makeSnapshot({
        session: AUTHENTICATED_ADMIN_SESSION,
        importExport: EMPTY_IMPORT,
      });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      expect(state.importAvailable).toBe(false);
    });
  });

  describe("secret exclusion", () => {
    it("readiness state carries no forbidden keys in offline state", () => {
      const snapshot = makeSnapshot({ status: OFFLINE_STATUS, publicStatus: null });
      const state = deriveGoVaultReadiness(snapshot);
      expect(() => assertNoSecretsInReadiness(state)).not.toThrow();
    });

    it("readiness state carries no forbidden keys in open_vault state", () => {
      const snapshot = makeSnapshot({
        session: AUTHENTICATED_ADMIN_SESSION,
        backup: HEALTHY_BACKUP,
        importExport: AVAILABLE_IMPORT,
      });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      expect(() => assertNoSecretsInReadiness(state)).not.toThrow();
    });

    it("readiness state does not surface user email or role", () => {
      const snapshot = makeSnapshot({ session: AUTHENTICATED_ADMIN_SESSION });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain("aloe@fly.pm");
      expect(serialized).not.toContain("admin");
    });

    it("readiness state does not surface vault routes beyond the next action target", () => {
      const snapshot = makeSnapshot({ session: AUTHENTICATED_ADMIN_SESSION });
      const state = deriveGoVaultReadiness(snapshot, makeBrowserSession("unlocked"));
      const stateKeys = Object.keys(state);
      expect(stateKeys).not.toContain("importRoute");
      expect(stateKeys).not.toContain("backupRoute");
      expect(stateKeys).not.toContain("devicesRoute");
      expect(stateKeys).not.toContain("settingsRoute");
    });
  });
});
