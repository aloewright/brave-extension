/**
 * Password-management boundary for the extension.
 *
 * Current strategy:
 * - Proton Pass is the user's active password manager.
 * - This extension does not expose a password-manager view.
 * - This extension does not inject passive password autofill.
 * - This extension must not persist decrypted vault passwords.
 *
 * Future Nodewarden/self-hosted work should treat the extension as a thin,
 * locked client. Store metadata only, keep decrypted secrets in memory after an
 * explicit unlock, and never bring back automatic submit behavior by default.
 */

export const PASSWORD_STRATEGY = {
  activeManager: "proton-pass",
  extensionStoresVaultPasswords: false,
  passiveAutofillEnabled: false,
  selfHostedNodewardenStatus: "deferred",
} as const;

export const LEGACY_PASSWORD_STORAGE_KEYS = [
  "passwords.autofill.cache",
  "passwords.autofill.selectedLoginId",
  "passwords.nodewarden.serverUrl",
  "passwords.disposableAliases",
] as const;

export interface PasswordAppStatus {
  ok: boolean;
  url: string;
  checkedAt: string;
  version: string | null;
  jwtUnsafeReason: "missing" | "default" | "too_short" | null;
  registrationInviteRequired: boolean | null;
  error: string | null;
}

interface PasswordAppBootstrapResponse {
  jwtUnsafeReason?: PasswordAppStatus["jwtUnsafeReason"];
  registrationInviteRequired?: boolean;
}

function buildPasswordAppUrl(baseUrl: string, path: string): string {
  const normalized = baseUrl.trim();
  if (!normalized) {
    throw new Error("Password app URL is empty.");
  }

  const url = new URL(normalized);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function fetchJsonWithTimeout<T>(
  url: string,
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function checkPasswordAppStatus(
  baseUrl: string,
): Promise<PasswordAppStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const [bootstrap, version] = await Promise.all([
      fetchJsonWithTimeout<PasswordAppBootstrapResponse>(
        buildPasswordAppUrl(baseUrl, "/api/web-bootstrap"),
      ),
      fetchJsonWithTimeout<string>(buildPasswordAppUrl(baseUrl, "/api/version")),
    ]);

    const jwtUnsafeReason = bootstrap.jwtUnsafeReason ?? null;
    return {
      ok: jwtUnsafeReason === null,
      url: baseUrl.trim(),
      checkedAt,
      version: typeof version === "string" ? version : null,
      jwtUnsafeReason,
      registrationInviteRequired:
        typeof bootstrap.registrationInviteRequired === "boolean"
          ? bootstrap.registrationInviteRequired
          : null,
      error: jwtUnsafeReason
        ? `JWT secret is ${jwtUnsafeReason.replace(/_/g, " ")}.`
        : null,
    };
  } catch (error) {
    return {
      ok: false,
      url: baseUrl.trim(),
      checkedAt,
      version: null,
      jwtUnsafeReason: null,
      registrationInviteRequired: null,
      error:
        error instanceof Error
          ? error.message
          : "Password app status check failed.",
    };
  }
}

export async function purgeLegacyPasswordStorage() {
  await chrome.storage.local.remove([...LEGACY_PASSWORD_STORAGE_KEYS]);
}

export async function getLegacyPasswordStorageState() {
  const result = await chrome.storage.local.get([...LEGACY_PASSWORD_STORAGE_KEYS]);
  return LEGACY_PASSWORD_STORAGE_KEYS.map((key) => ({
    key,
    present: result[key] !== undefined,
  }));
}
