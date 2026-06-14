import {
  buildPasswordAppUrl,
  checkPasswordAppStatus,
  type PasswordAppStatus,
} from "./password-strategy";

export type GoVaultJwtUnsafeReason = "missing" | "default" | "too_short" | null;
export type GoVaultSessionState = "authenticated" | "not_linked";
export type GoVaultBackupState =
  | "available"
  | "not_admin"
  | "not_linked"
  | "needs_reactivation";
export type GoVaultImportState = "available" | "not_linked";

export interface GoVaultPublicStatus {
  object: "go-extension-status";
  ok: boolean;
  checkedAt: string;
  version: string;
  jwtUnsafeReason: GoVaultJwtUnsafeReason;
  jwtSecretMinLength: number;
  registrationInviteRequired: boolean;
  bridgeVersion: 1;
  storagePolicy: {
    extensionStoresVaultPasswords: false;
    decryptedSecretsStoredByExtension: false;
    passiveAutofillEnabled: false;
  };
  capabilities: {
    vault: boolean;
    imports: boolean;
    backups: boolean;
    devices: boolean;
    settings: boolean;
    extensionReadOnlyStatus: boolean;
  };
  routes: {
    vault: string;
    importExport: string;
    backups: string;
    devices: string;
    settings: string;
    login: string;
  };
  apiRoutes: {
    status: string;
    session: string;
    backupStatus: string;
    importStatus: string;
  };
}

export interface GoVaultSessionStatus {
  object: "go-extension-session";
  state: GoVaultSessionState;
  checkedAt: string;
  user: {
    email: string;
    name: string | null;
    role: "admin" | "user";
    status: "active" | "banned";
  } | null;
  capabilities: {
    canOpenVault: boolean;
    canImport: boolean;
    canManageBackups: boolean;
    canManageDevices: boolean;
  };
}

export interface GoVaultBackupDestinationStatus {
  id: string;
  name: string;
  type: "s3" | "webdav";
  configured: boolean;
  includeAttachments: boolean;
  schedule: {
    enabled: boolean;
    intervalHours: number;
    startTime: string;
    timezone: string;
    retentionCount: number | null;
  };
  runtime: {
    lastAttemptAt: string | null;
    lastAttemptLocalDate: string | null;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastUploadedFileName: string | null;
    lastUploadedSizeBytes: number | null;
    lastErrorSummary: string | null;
  };
}

export interface GoVaultBackupStatus {
  object: "go-extension-backup-status";
  state: GoVaultBackupState;
  checkedAt: string;
  destinations: GoVaultBackupDestinationStatus[];
  summary: {
    destinationCount: number;
    configuredDestinationCount: number;
    scheduledDestinationCount: number;
    healthyDestinationCount: number;
    lastSuccessAt: string | null;
    lastAttemptAt: string | null;
    lastErrorAt: string | null;
  };
}

export interface GoVaultImportStatus {
  object: "go-extension-import-status";
  state: GoVaultImportState;
  checkedAt: string;
  directImportFromExtension: false;
  route: string;
  supportedSources: string[];
}

export interface GoVaultBridgeSnapshot {
  checkedAt: string;
  status: PasswordAppStatus;
  publicStatus: GoVaultPublicStatus | null;
  session: GoVaultSessionStatus;
  backup: GoVaultBackupStatus;
  importExport: GoVaultImportStatus;
}

function emptySessionStatus(): GoVaultSessionStatus {
  return {
    object: "go-extension-session",
    state: "not_linked",
    checkedAt: new Date().toISOString(),
    user: null,
    capabilities: {
      canOpenVault: false,
      canImport: false,
      canManageBackups: false,
      canManageDevices: false,
    },
  };
}

function emptyBackupStatus(): GoVaultBackupStatus {
  return {
    object: "go-extension-backup-status",
    state: "not_linked",
    checkedAt: new Date().toISOString(),
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
}

function emptyImportStatus(): GoVaultImportStatus {
  return {
    object: "go-extension-import-status",
    state: "not_linked",
    checkedAt: new Date().toISOString(),
    directImportFromExtension: false,
    route: "/backup/import-export",
    supportedSources: [],
  };
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 5000,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
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

function authHeaders(bearer: string): HeadersInit {
  return {
    Authorization: `Bearer ${bearer}`,
  };
}

export async function fetchGoExtensionStatus(
  baseUrl: string,
): Promise<GoVaultPublicStatus> {
  return fetchJsonWithTimeout<GoVaultPublicStatus>(
    buildPasswordAppUrl(baseUrl, "/api/extension/status"),
  );
}

export async function fetchGoExtensionSessionStatus(
  baseUrl: string,
  bearer?: string | null,
): Promise<GoVaultSessionStatus> {
  if (!bearer) return emptySessionStatus();
  return fetchJsonWithTimeout<GoVaultSessionStatus>(
    buildPasswordAppUrl(baseUrl, "/api/extension/session"),
    { headers: authHeaders(bearer) },
  );
}

export async function fetchGoExtensionBackupStatus(
  baseUrl: string,
  bearer?: string | null,
): Promise<GoVaultBackupStatus> {
  if (!bearer) return emptyBackupStatus();
  return fetchJsonWithTimeout<GoVaultBackupStatus>(
    buildPasswordAppUrl(baseUrl, "/api/extension/backup/status"),
    { headers: authHeaders(bearer) },
  );
}

export async function fetchGoExtensionImportStatus(
  baseUrl: string,
  bearer?: string | null,
): Promise<GoVaultImportStatus> {
  if (!bearer) return emptyImportStatus();
  return fetchJsonWithTimeout<GoVaultImportStatus>(
    buildPasswordAppUrl(baseUrl, "/api/extension/import/status"),
    { headers: authHeaders(bearer) },
  );
}

function toPasswordAppStatus(
  baseUrl: string,
  publicStatus: GoVaultPublicStatus,
): PasswordAppStatus {
  return {
    ok: publicStatus.ok,
    url: baseUrl.trim(),
    checkedAt: publicStatus.checkedAt,
    version: publicStatus.version || null,
    jwtUnsafeReason: publicStatus.jwtUnsafeReason,
    registrationInviteRequired: publicStatus.registrationInviteRequired,
    error: publicStatus.jwtUnsafeReason
      ? `JWT secret is ${publicStatus.jwtUnsafeReason.replace(/_/g, " ")}.`
      : null,
  };
}

export async function checkGoVaultBridge(
  baseUrl: string,
  bearer?: string | null,
): Promise<GoVaultBridgeSnapshot> {
  const checkedAt = new Date().toISOString();
  let publicStatus: GoVaultPublicStatus | null = null;
  let status: PasswordAppStatus;

  try {
    publicStatus = await fetchGoExtensionStatus(baseUrl);
    status = toPasswordAppStatus(baseUrl, publicStatus);
  } catch {
    status = await checkPasswordAppStatus(baseUrl);
  }

  if (!publicStatus) {
    return {
      checkedAt,
      status,
      publicStatus: null,
      session: emptySessionStatus(),
      backup: emptyBackupStatus(),
      importExport: emptyImportStatus(),
    };
  }

  const [session, backup, importExport] = await Promise.all([
    fetchGoExtensionSessionStatus(baseUrl, bearer).catch(() => emptySessionStatus()),
    fetchGoExtensionBackupStatus(baseUrl, bearer).catch(() => emptyBackupStatus()),
    fetchGoExtensionImportStatus(baseUrl, bearer).catch(() => emptyImportStatus()),
  ]);

  return {
    checkedAt,
    status,
    publicStatus,
    session,
    backup,
    importExport,
  };
}
