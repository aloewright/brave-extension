export const GO_VAULT_BROWSER_SESSION_EVENT = "go-vault:browser-session:v1";
export const GO_VAULT_SESSION_STATUS_MESSAGE = "GO_VAULT_SESSION_STATUS";
export const GO_VAULT_SESSION_STATUS_STORAGE_KEY =
  "passwords.go.sessionStatus.v1";

export type GoVaultBrowserSessionState = "signed_out" | "locked" | "unlocked";

export interface GoVaultBrowserSessionStatus {
  object: "go-vault-browser-session";
  version: 1;
  origin: string;
  state: GoVaultBrowserSessionState;
  email: string | null;
  role: "admin" | "user" | null;
  route: string;
  checkedAt: string;
}

const ALLOWED_ORIGINS = new Set(["https://go.lazee.workers.dev"]);
const MAX_EMAIL_LENGTH = 320;
const MAX_ROUTE_LENGTH = 120;

function safeString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeOrigin(value: unknown): string | null {
  const raw = safeString(value, 512);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin;
  } catch {
    return null;
  }
}

function normalizeRoute(value: unknown): string {
  const raw = safeString(value, MAX_ROUTE_LENGTH);
  if (!raw || !raw.startsWith("/")) return "/";
  return raw;
}

function normalizeCheckedAt(value: unknown): string {
  const raw = safeString(value, 64);
  if (!raw) return new Date().toISOString();
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return new Date().toISOString();
  return new Date(parsed).toISOString();
}

export function isAllowedGoVaultOrigin(origin: string | null): boolean {
  return !!origin && ALLOWED_ORIGINS.has(origin);
}

export function goVaultOriginFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function sanitizeGoVaultBrowserSessionStatus(
  input: unknown,
  expectedOrigin?: string | null,
): GoVaultBrowserSessionStatus | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (record.object !== "go-vault-browser-session") return null;
  if (record.version !== 1) return null;

  const origin = normalizeOrigin(record.origin);
  if (!isAllowedGoVaultOrigin(origin)) return null;
  if (expectedOrigin && origin !== expectedOrigin) return null;

  const state = record.state;
  if (state !== "signed_out" && state !== "locked" && state !== "unlocked") {
    return null;
  }

  const role = record.role === "admin" || record.role === "user"
    ? record.role
    : null;

  return {
    object: "go-vault-browser-session",
    version: 1,
    origin,
    state,
    email: safeString(record.email, MAX_EMAIL_LENGTH),
    role,
    route: normalizeRoute(record.route),
    checkedAt: normalizeCheckedAt(record.checkedAt),
  };
}

export async function saveGoVaultBrowserSessionStatus(
  status: GoVaultBrowserSessionStatus,
): Promise<void> {
  await chrome.storage.local.set({ [GO_VAULT_SESSION_STATUS_STORAGE_KEY]: status });
}

export async function readGoVaultBrowserSessionStatus(
  baseUrl: string,
): Promise<GoVaultBrowserSessionStatus | null> {
  const expectedOrigin = goVaultOriginFromUrl(baseUrl);
  if (!expectedOrigin) return null;
  const result = await chrome.storage.local.get(GO_VAULT_SESSION_STATUS_STORAGE_KEY);
  return sanitizeGoVaultBrowserSessionStatus(
    result[GO_VAULT_SESSION_STATUS_STORAGE_KEY],
    expectedOrigin,
  );
}
