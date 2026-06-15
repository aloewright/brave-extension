import type { GoVaultBridgeSnapshot } from "./go-vault-client";
import type { GoVaultBrowserSessionStatus } from "./go-vault-session-state";

export type GoVaultReadinessAction =
  | "open_vault"
  | "sign_in"
  | "unlock"
  | "configure"
  | "offline";

export interface GoVaultReadinessState {
  action: GoVaultReadinessAction;
  reachable: boolean;
  vaultRoute: string;
  backupHealthy: boolean | null;
  importAvailable: boolean;
}

const FORBIDDEN_READINESS_KEYS = new Set([
  "accessToken",
  "refreshToken",
  "password",
  "cipher",
  "key",
  "webdavPassword",
  "token",
  "secret",
  "masterKey",
]);

export function assertNoSecretsInReadiness(state: GoVaultReadinessState): void {
  const keys = Object.keys(state);
  for (const key of keys) {
    if (FORBIDDEN_READINESS_KEYS.has(key)) {
      throw new Error(`Forbidden key "${key}" found in readiness state`);
    }
  }
}

export function deriveGoVaultReadiness(
  snapshot: GoVaultBridgeSnapshot,
  browserSession?: GoVaultBrowserSessionStatus | null,
): GoVaultReadinessState {
  const reachable = snapshot.status.ok;

  if (!reachable) {
    return {
      action: "offline",
      reachable: false,
      vaultRoute: "/vault",
      backupHealthy: null,
      importAvailable: false,
    };
  }

  const routes = snapshot.publicStatus?.routes;
  const vaultRoute = routes?.vault ?? "/vault";

  if (!snapshot.publicStatus) {
    return {
      action: "configure",
      reachable: true,
      vaultRoute,
      backupHealthy: null,
      importAvailable: false,
    };
  }

  if (browserSession) {
    if (browserSession.state === "signed_out") {
      return {
        action: "sign_in",
        reachable: true,
        vaultRoute: routes?.login ?? "/login",
        backupHealthy: null,
        importAvailable: false,
      };
    }

    if (browserSession.state === "locked") {
      return {
        action: "unlock",
        reachable: true,
        vaultRoute: routes?.login ?? "/login",
        backupHealthy: null,
        importAvailable: false,
      };
    }
  }

  const apiSession = snapshot.session;
  if (apiSession.state === "not_linked") {
    return {
      action: "sign_in",
      reachable: true,
      vaultRoute: routes?.login ?? "/login",
      backupHealthy: null,
      importAvailable: false,
    };
  }

  const backup = snapshot.backup;
  let backupHealthy: boolean | null = null;
  if (apiSession.capabilities.canManageBackups && backup.state === "available") {
    const { summary } = backup;
    backupHealthy =
      summary.destinationCount > 0 &&
      summary.healthyDestinationCount === summary.destinationCount;
  }

  const importAvailable =
    snapshot.importExport.state === "available" &&
    snapshot.importExport.supportedSources.length > 0;

  return {
    action: "open_vault",
    reachable: true,
    vaultRoute,
    backupHealthy,
    importAvailable,
  };
}
