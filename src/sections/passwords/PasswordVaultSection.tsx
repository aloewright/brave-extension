import { useCallback, useEffect, useMemo, useState } from "react";
import { LeoButton, LeoIcon, type LeoIconName } from "../../components/leo";
import { useSettings } from "../../hooks/useSettings";
import { openExternalUrl } from "../../lib/open-url";
import {
  PASSWORD_STRATEGY,
  buildPasswordAppUrl,
  checkPasswordAppStatus,
  type PasswordAppStatus,
} from "../../lib/password-strategy";
import { DEFAULT_SETTINGS } from "../../types";

interface VaultRoute {
  label: string;
  path: string;
  icon: LeoIconName;
  meta: string;
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

export function PasswordVaultSection() {
  const { settings, update } = useSettings();
  const [status, setStatus] = useState<PasswordAppStatus | null>(null);
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

  const refreshStatus = useCallback(async () => {
    if (!baseUrl || checking) return;
    setChecking(true);
    setMessage(null);
    try {
      setStatus(await checkPasswordAppStatus(baseUrl));
    } catch (error) {
      setStatus({
        ok: false,
        url: baseUrl,
        checkedAt: new Date().toISOString(),
        version: null,
        jwtUnsafeReason: null,
        registrationInviteRequired: null,
        error:
          error instanceof Error
            ? error.message
            : "Password app status check failed.",
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
