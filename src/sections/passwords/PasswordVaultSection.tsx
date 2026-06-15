import { useCallback, useEffect, useMemo, useState } from "react";
import { LeoButton, LeoIcon, type LeoIconName } from "../../components/leo";
import { useSettings } from "../../hooks/useSettings";
import {
  checkGoVaultBridge,
  type GoVaultBackupStatus,
  type GoVaultBridgeSnapshot,
  type GoVaultImportStatus,
  type GoVaultSessionStatus,
} from "../../lib/go-vault-client";
import {
  GO_VAULT_SESSION_STATUS_STORAGE_KEY,
  goVaultBrowserSessionRefreshDelayMs,
  isFreshGoVaultBrowserSessionStatus,
  readGoVaultBrowserSessionStatus,
  type GoVaultBrowserSessionStatus,
} from "../../lib/go-vault-session-state";
import {
  deriveGoVaultReadiness,
  type GoVaultReadinessState,
} from "../../lib/go-vault-readiness";
import { openExternalUrl } from "../../lib/open-url";
import {
  PASSWORD_STRATEGY,
  buildPasswordAppUrl,
  type PasswordAppStatus,
} from "../../lib/password-strategy";
import { DEFAULT_SETTINGS } from "../../types";

interface VaultRoute {
  label: string;
  path: string;
  icon: LeoIconName;
  meta: string;
}

interface OperationCard {
  label: string;
  value: string;
  detail: string;
  icon: LeoIconName;
  path: string;
}

const VAULT_ROUTES: VaultRoute[] = [
  { label: "Vault", path: "/vault", icon: "lock", meta: "Items" },
  {
    label: "Import / Export",
    path: "/backup/import-export",
    icon: "file-export",
    meta: "Migration",
  },
  { label: "Backups", path: "/backup", icon: "cloud", meta: "WebDAV" },
  {
    label: "Devices",
    path: "/security/devices",
    icon: "shield",
    meta: "Sessions",
  },
  { label: "Settings", path: "/settings", icon: "settings", meta: "Account" },
];

function statusLabel(
  checking: boolean,
  status: PasswordAppStatus | null,
): string {
  if (checking) return "Checking";
  if (!status) return "Not checked";
  return status.ok ? "Reachable" : "Needs attention";
}

function statusDetail(status: PasswordAppStatus | null): string {
  if (!status) return "No live status yet";
  if (status.ok) return status.version ? `Version ${status.version}` : "API online";
  return status.error || "Status check failed";
}

function displayTime(status: PasswordAppStatus | null): string {
  if (!status) return "Never";
  return new Date(status.checkedAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function sessionLabel(session: GoVaultSessionStatus | null): string {
  if (!session || session.state === "not_linked") return "Not linked";
  return session.user?.email || "Authenticated";
}

function sessionDetail(session: GoVaultSessionStatus | null): string {
  if (!session || session.state === "not_linked") return "Open go to sign in";
  return session.user?.role === "admin" ? "Admin session" : "User session";
}

function isFreshBrowserSession(
  session: GoVaultBrowserSessionStatus | null,
): session is GoVaultBrowserSessionStatus {
  return isFreshGoVaultBrowserSessionStatus(session);
}

function browserSessionLabel(
  session: GoVaultBrowserSessionStatus | null,
): string {
  if (session && !isFreshBrowserSession(session)) return "Stale go tab";
  if (!session) return "Not linked";
  if (session.state === "unlocked") return session.email || "Unlocked in go";
  if (session.state === "locked") return "Locked in go";
  return "Signed out";
}

function browserSessionDetail(
  session: GoVaultBrowserSessionStatus | null,
): string {
  if (session && !isFreshBrowserSession(session)) return "Open go to refresh status";
  if (!session) return "Open go to sign in";
  if (session.state === "unlocked") {
    return session.role === "admin" ? "Live admin go tab" : "Live go tab";
  }
  if (session.state === "locked") return "Open go to unlock";
  return "Open go to sign in";
}

function displaySessionLabel(
  session: GoVaultSessionStatus | null,
  browserSession: GoVaultBrowserSessionStatus | null,
): string {
  if (session?.state === "authenticated") return sessionLabel(session);
  return browserSessionLabel(browserSession);
}

function displaySessionDetail(
  session: GoVaultSessionStatus | null,
  browserSession: GoVaultBrowserSessionStatus | null,
): string {
  if (session?.state === "authenticated") return sessionDetail(session);
  return browserSessionDetail(browserSession);
}

function sessionRoute(
  session: GoVaultSessionStatus | null,
  browserSession: GoVaultBrowserSessionStatus | null,
): string {
  if (session?.state === "authenticated") return "/vault";
  if (isFreshBrowserSession(browserSession)) {
    if (browserSession.state === "unlocked") return "/vault";
    if (browserSession.state === "locked") return "/login";
  }
  return "/login";
}

function readinessLabel(
  checking: boolean,
  readiness: GoVaultReadinessState | null,
): string {
  if (checking) return "Checking go";
  if (!readiness) return "Not checked";
  if (readiness.action === "offline") return "Offline";
  if (readiness.action === "configure") return "Bridge pending";
  if (readiness.action === "sign_in") return "Sign in to go";
  if (readiness.action === "unlock") return "Unlock in go";
  return "Open vault";
}

function readinessDetail(
  readiness: GoVaultReadinessState | null,
  browserSession: GoVaultBrowserSessionStatus | null,
): string {
  if (browserSession && !isFreshBrowserSession(browserSession)) {
    return "Go tab status expired";
  }
  if (!readiness) return "Run a status check";
  if (readiness.action === "offline") return "Open go after service recovers";
  if (readiness.action === "configure") return "Public bridge not deployed";
  if (readiness.action === "sign_in") return "Authentication stays in go";
  if (readiness.action === "unlock") return "Unlock inside the go app";
  if (readiness.backupHealthy === false) return "Backup needs attention in go";
  if (readiness.importAvailable) return "Route-only actions are ready";
  return "Secrets stay inside go";
}

function readinessIcon(readiness: GoVaultReadinessState | null): LeoIconName {
  if (!readiness) return "shield";
  if (readiness.action === "offline") return "warning-triangle-outline";
  if (readiness.action === "configure") return "settings";
  if (readiness.action === "sign_in") return "avatar";
  if (readiness.action === "unlock") return "lock";
  return "check-normal";
}

function backupLabel(backup: GoVaultBackupStatus | null): string {
  if (!backup || backup.state === "not_linked") return "Needs go session";
  if (backup.state === "not_admin") return "Admin only";
  if (backup.state === "needs_reactivation") return "Needs repair";
  if (backup.summary.destinationCount === 0) return "No destinations";
  return `${backup.summary.configuredDestinationCount}/${backup.summary.destinationCount} configured`;
}

function backupDetail(backup: GoVaultBackupStatus | null): string {
  if (!backup || backup.state === "not_linked") return "Status stays in go";
  if (backup.state === "not_admin") return "Current user cannot manage backups";
  if (backup.state === "needs_reactivation") return "Open backup settings in go";
  if (backup.summary.lastSuccessAt) {
    return `Last success ${new Date(backup.summary.lastSuccessAt).toLocaleDateString()}`;
  }
  if (backup.summary.scheduledDestinationCount > 0) return "Scheduled, no success yet";
  return "Manual backups ready";
}

function importLabel(importExport: GoVaultImportStatus | null): string {
  if (!importExport || importExport.state === "not_linked") return "Open in go";
  return "Ready";
}

function importDetail(importExport: GoVaultImportStatus | null): string {
  if (!importExport || importExport.state === "not_linked") return "Secrets handled by go";
  if (importExport.supportedSources.length > 0) {
    return `${importExport.supportedSources.length} source formats`;
  }
  return "Import/export enabled";
}

function getGoVaultBridgeBearer(): string | null {
  // See docs/go-token-session-handoff.md: no go token handoff exists yet.
  return null;
}

export function PasswordVaultSection() {
  const { settings, update } = useSettings();
  const [bridge, setBridge] = useState<GoVaultBridgeSnapshot | null>(null);
  const [browserSession, setBrowserSession] =
    useState<GoVaultBrowserSessionStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const baseUrl = useMemo(
    () =>
      settings?.passwordAppUrl.trim() ||
      DEFAULT_SETTINGS.passwordAppUrl,
    [settings?.passwordAppUrl],
  );
  const isGoProvider =
    settings?.passwordManagerProvider === "nodewarden-self-hosted";
  const status = bridge?.status ?? null;
  const freshBrowserSession = isFreshBrowserSession(browserSession)
    ? browserSession
    : null;
  const readiness = bridge
    ? deriveGoVaultReadiness(bridge, freshBrowserSession)
    : null;

  const refreshStatus = useCallback(async () => {
    if (!baseUrl || checking) return;
    setChecking(true);
    setMessage(null);
    try {
      setBridge(await checkGoVaultBridge(baseUrl, getGoVaultBridgeBearer()));
    } catch (error) {
      const checkedAt = new Date().toISOString();
      setBridge({
        checkedAt,
        status: {
          ok: false,
          url: baseUrl,
          checkedAt,
          version: null,
          jwtUnsafeReason: null,
          registrationInviteRequired: null,
          error:
            error instanceof Error
              ? error.message
              : "Password app status check failed.",
        },
        publicStatus: null,
        session: {
          object: "go-extension-session",
          state: "not_linked",
          checkedAt,
          user: null,
          capabilities: {
            canOpenVault: false,
            canImport: false,
            canManageBackups: false,
            canManageDevices: false,
          },
        },
        backup: {
          object: "go-extension-backup-status",
          state: "not_linked",
          checkedAt,
          directBackupFromExtension: false,
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
        },
        importExport: {
          object: "go-extension-import-status",
          state: "not_linked",
          checkedAt,
          directImportFromExtension: false,
          route: "/backup/import-export",
          supportedSources: [],
        },
      });
    } finally {
      setChecking(false);
    }
  }, [baseUrl, checking]);

  useEffect(() => {
    if (!settings) return;
    void refreshStatus();
    // Run once per configured URL. Manual checks use the button below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings?.passwordAppUrl]);

  useEffect(() => {
    let cancelled = false;
    readGoVaultBrowserSessionStatus(baseUrl)
      .then((next) => {
        if (!cancelled) setBrowserSession(next);
      })
      .catch(() => {
        if (!cancelled) setBrowserSession(null);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return;
    let cancelled = false;

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ) => {
      if (areaName !== "local") return;
      if (!changes[GO_VAULT_SESSION_STATUS_STORAGE_KEY]) return;
      void readGoVaultBrowserSessionStatus(baseUrl).then((next) => {
        if (!cancelled) setBrowserSession(next);
      });
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, [baseUrl]);

  useEffect(() => {
    const delayMs = goVaultBrowserSessionRefreshDelayMs(browserSession);
    if (delayMs === null || delayMs <= 0) return;

    const timer = window.setTimeout(() => {
      setBrowserSession((current) => {
        if (
          current?.origin !== browserSession?.origin ||
          current?.checkedAt !== browserSession?.checkedAt
        ) {
          return current;
        }
        return null;
      });
    }, delayMs);

    return () => window.clearTimeout(timer);
  }, [browserSession?.origin, browserSession?.checkedAt]);

  const openRoute = (path: string) => {
    try {
      void openExternalUrl(buildPasswordAppUrl(baseUrl, path));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid vault URL.");
    }
  };

  const makeGoProvider = () => {
    void update({
      passwordManagerProvider: "nodewarden-self-hosted",
      passwordAppUrl: baseUrl,
    }).then(() => setMessage("go is now the password provider of record."));
  };

  if (!settings) return null;

  const operations: OperationCard[] = [
    {
      label: "Next step",
      value: readinessLabel(checking, readiness),
      detail: readinessDetail(readiness, browserSession),
      icon: readinessIcon(readiness),
      path: readiness?.vaultRoute ?? sessionRoute(bridge?.session ?? null, browserSession),
    },
    {
      label: "Session",
      value: displaySessionLabel(bridge?.session ?? null, browserSession),
      detail: displaySessionDetail(bridge?.session ?? null, browserSession),
      icon: "avatar",
      path: sessionRoute(bridge?.session ?? null, browserSession),
    },
    {
      label: "Backups",
      value: backupLabel(bridge?.backup ?? null),
      detail: backupDetail(bridge?.backup ?? null),
      icon: "cloud",
      path: "/backup",
    },
    {
      label: "Import / Export",
      value: importLabel(bridge?.importExport ?? null),
      detail: importDetail(bridge?.importExport ?? null),
      icon: "file-export",
      path: "/backup/import-export",
    },
    {
      label: "Bridge",
      value: bridge?.publicStatus ? "Read-only" : "Legacy probe",
      detail: "No secret material crosses into the extension",
      icon: "shield",
      path: "/settings",
    },
  ];

  return (
    <section
      className="flex h-full min-w-0 flex-col overflow-hidden bg-bg text-fg"
      data-testid="passwords-section"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-fg">Vault</h2>
          <p className="truncate text-[11px] text-fg/45">{baseUrl}</p>
        </div>
        <LeoButton
          type="button"
          size="xs"
          variant={status?.ok ? "success" : "neutral"}
          disabled={checking}
          onClick={() => void refreshStatus()}
        >
          {checking ? "Checking" : "Check"}
        </LeoButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4">
        <div className="mb-4 rounded border border-border bg-card/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <LeoIcon name="lock" size={16} className="shrink-0 text-primary" />
                <span className="truncate text-sm font-semibold text-fg">
                  go password vault
                </span>
              </div>
              <p className="mt-1 break-all text-[11px] leading-5 text-fg/45">
                {baseUrl}
              </p>
            </div>
            <span
              className={`shrink-0 rounded px-2 py-1 text-[10px] uppercase tracking-normal ${
                isGoProvider
                  ? "bg-success/15 text-success"
                  : "bg-warning/15 text-warning"
              }`}
            >
              {isGoProvider ? "Active" : "Inactive"}
            </span>
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <div className="rounded border border-border bg-bg/35 p-2">
              <div className="text-[10px] uppercase tracking-normal text-fg/35">
                Status
              </div>
              <div className="mt-1 truncate text-xs font-medium text-fg">
                {statusLabel(checking, status)}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-fg/45">
                {statusDetail(status)}
              </div>
            </div>
            <div className="rounded border border-border bg-bg/35 p-2">
              <div className="text-[10px] uppercase tracking-normal text-fg/35">
                Last check
              </div>
              <div className="mt-1 truncate text-xs font-medium text-fg">
                {displayTime(status)}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-fg/45">
                {status?.registrationInviteRequired === false
                  ? "Registration open"
                  : status?.registrationInviteRequired === true
                    ? "Invite gated"
                    : "Unknown gate"}
              </div>
            </div>
            <div className="rounded border border-border bg-bg/35 p-2">
              <div className="text-[10px] uppercase tracking-normal text-fg/35">
                Extension storage
              </div>
              <div className="mt-1 truncate text-xs font-medium text-fg">
                No vault secrets
              </div>
              <div className="mt-0.5 truncate text-[11px] text-fg/45">
                Autofill {PASSWORD_STRATEGY.passiveAutofillEnabled ? "on" : "off"}
              </div>
            </div>
          </div>

          {!isGoProvider && (
            <LeoButton
              type="button"
              size="xs"
              variant="primary"
              className="mt-3"
              onClick={makeGoProvider}
            >
              Make go active
            </LeoButton>
          )}
        </div>

        <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
          {operations.map((operation) => (
            <button
              key={operation.label}
              type="button"
              aria-label={operation.label}
              onClick={() => openRoute(operation.path)}
              className="min-w-0 rounded border border-border bg-card/25 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
            >
              <div className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-bg/40 text-primary">
                  <LeoIcon name={operation.icon} size={16} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[10px] uppercase tracking-normal text-fg/35">
                    {operation.label}
                  </div>
                  <div className="mt-1 truncate text-xs font-semibold text-fg">
                    {operation.value}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-fg/45">
                    {operation.detail}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2">
          {VAULT_ROUTES.map((route) => (
            <button
              key={route.path}
              type="button"
              aria-label={route.label}
              onClick={() => openRoute(route.path)}
              className="min-w-0 rounded border border-border bg-card/35 p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-bg/40 text-primary">
                  <LeoIcon name={route.icon} size={16} />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-fg">
                    {route.label}
                  </div>
                  <div className="truncate text-[11px] text-fg/40">
                    {route.meta}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="rounded border border-border bg-card/20 p-3">
            <div className="text-[10px] uppercase tracking-normal text-fg/35">
              Vault passwords
            </div>
            <div className="mt-1 text-xs font-medium text-success">
              Stored in go
            </div>
          </div>
          <div className="rounded border border-border bg-card/20 p-3">
            <div className="text-[10px] uppercase tracking-normal text-fg/35">
              Decrypted secrets
            </div>
            <div className="mt-1 text-xs font-medium text-success">
              Not stored by extension
            </div>
          </div>
        </div>

        {message && (
          <p className="mt-3 rounded border border-border bg-bg/35 p-2 text-[11px] leading-5 text-fg/55">
            {message}
          </p>
        )}
      </div>
    </section>
  );
}
