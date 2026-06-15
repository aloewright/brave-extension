import type {
  BackupDestinationConfig,
  BackupDestinationRecord,
  BackupDestinationType,
  BackupRuntimeState,
  BackupScheduleConfig,
  BackupSettings,
} from '../shared/backup-schema';

export type ExtensionJwtUnsafeReason = 'missing' | 'default' | 'too_short' | null;
export type ExtensionSessionState = 'authenticated' | 'not_linked';
export type ExtensionBackupState = 'available' | 'not_admin' | 'not_linked' | 'needs_reactivation';
export type ExtensionImportState = 'available' | 'not_linked';
export type ExtensionDeviceState = 'available' | 'not_linked';

export interface ExtensionPublicStatusInput {
  version: string;
  jwtUnsafeReason: ExtensionJwtUnsafeReason;
  jwtSecretMinLength: number;
  registrationInviteRequired: boolean;
}

export interface ExtensionPublicStatusResponse {
  object: 'go-extension-status';
  ok: boolean;
  checkedAt: string;
  version: string;
  jwtUnsafeReason: ExtensionJwtUnsafeReason;
  jwtSecretMinLength: number;
  registrationInviteRequired: boolean;
  bridgeVersion: 1;
  storagePolicy: {
    extensionStoresVaultPasswords: false;
    decryptedSecretsStoredByExtension: false;
    passiveAutofillEnabled: false;
  };
  capabilities: {
    vault: true;
    imports: true;
    backups: true;
    devices: true;
    settings: true;
    extensionReadOnlyStatus: true;
  };
  routes: {
    vault: '/vault';
    importExport: '/backup/import-export';
    backups: '/backup';
    devices: '/security/devices';
    settings: '/settings';
    login: '/login';
  };
  apiRoutes: {
    status: '/api/extension/status';
    session: '/api/extension/session';
    backupStatus: '/api/extension/backup/status';
    importStatus: '/api/extension/import/status';
    deviceStatus: '/api/extension/device/status';
  };
}

export interface ExtensionSessionUserInput {
  email: string;
  name: string | null;
  role: 'admin' | 'user';
  status: 'active' | 'banned';
}

export interface ExtensionSessionStatusResponse {
  object: 'go-extension-session';
  state: ExtensionSessionState;
  checkedAt: string;
  user: {
    email: string;
    name: string | null;
    role: 'admin' | 'user';
    status: 'active' | 'banned';
  } | null;
  capabilities: {
    canOpenVault: boolean;
    canImport: boolean;
    canManageBackups: boolean;
    canManageDevices: boolean;
  };
}

export interface ExtensionBackupDestinationStatus {
  id: string;
  name: string;
  type: BackupDestinationType;
  configured: boolean;
  includeAttachments: boolean;
  schedule: Pick<BackupScheduleConfig, 'enabled' | 'intervalHours' | 'startTime' | 'timezone' | 'retentionCount'>;
  runtime: Pick<
    BackupRuntimeState,
    'lastAttemptAt' | 'lastAttemptLocalDate' | 'lastSuccessAt' | 'lastErrorAt' | 'lastUploadedFileName' | 'lastUploadedSizeBytes'
  > & {
    lastErrorSummary: string | null;
  };
}

export interface ExtensionBackupStatusResponse {
  object: 'go-extension-backup-status';
  state: ExtensionBackupState;
  checkedAt: string;
  destinations: ExtensionBackupDestinationStatus[];
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

export interface ExtensionImportStatusResponse {
  object: 'go-extension-import-status';
  state: ExtensionImportState;
  checkedAt: string;
  directImportFromExtension: false;
  route: '/backup/import-export';
  supportedSources: string[];
}

export interface ExtensionDeviceReadinessInput {
  totalDeviceCount: number;
  trustedDeviceCount: number;
  verifyDevicesEnabled: boolean;
}

export interface ExtensionDeviceReadinessResponse {
  object: 'go-extension-device-readiness';
  state: ExtensionDeviceState;
  checkedAt: string;
  directDeviceMutationFromExtension: false;
  route: '/security/devices';
  summary: {
    totalDeviceCount: number;
    trustedDeviceCount: number;
    verifyDevicesEnabled: boolean;
  };
}

const SUPPORTED_IMPORT_SOURCES = [
  'Bitwarden',
  'Proton Pass',
  '1Password',
  'LastPass',
  'Chrome CSV',
  'Generic CSV',
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

export function buildExtensionPublicStatus(input: ExtensionPublicStatusInput): ExtensionPublicStatusResponse {
  return {
    object: 'go-extension-status',
    ok: input.jwtUnsafeReason === null,
    checkedAt: nowIso(),
    version: input.version,
    jwtUnsafeReason: input.jwtUnsafeReason,
    jwtSecretMinLength: input.jwtSecretMinLength,
    registrationInviteRequired: input.registrationInviteRequired,
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
      vault: '/vault',
      importExport: '/backup/import-export',
      backups: '/backup',
      devices: '/security/devices',
      settings: '/settings',
      login: '/login',
    },
    apiRoutes: {
      status: '/api/extension/status',
      session: '/api/extension/session',
      backupStatus: '/api/extension/backup/status',
      importStatus: '/api/extension/import/status',
      deviceStatus: '/api/extension/device/status',
    },
  };
}

export function buildExtensionSessionStatus(user: ExtensionSessionUserInput | null): ExtensionSessionStatusResponse {
  const authenticated = !!user;
  const isAdmin = user?.role === 'admin';
  return {
    object: 'go-extension-session',
    state: authenticated ? 'authenticated' : 'not_linked',
    checkedAt: nowIso(),
    user: user
      ? {
          email: user.email,
          name: user.name,
          role: user.role,
          status: user.status,
        }
      : null,
    capabilities: {
      canOpenVault: authenticated,
      canImport: authenticated,
      canManageBackups: authenticated && isAdmin,
      canManageDevices: authenticated,
    },
  };
}

function hasStringValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function isDestinationConfigured(type: BackupDestinationType, destination: BackupDestinationConfig): boolean {
  if (type === 's3') {
    return (
      'endpoint' in destination
      && hasStringValue(destination.endpoint)
      && hasStringValue(destination.bucket)
      && hasStringValue(destination.accessKeyId)
      && hasStringValue(destination.secretAccessKey)
    );
  }

  return (
    'baseUrl' in destination
    && hasStringValue(destination.baseUrl)
    && hasStringValue(destination.username)
    && hasStringValue(destination.password)
  );
}

function pickLatestIso(values: Array<string | null | undefined>): string | null {
  const filtered = values.filter((value): value is string => typeof value === 'string' && value.length > 0);
  if (filtered.length === 0) return null;
  return filtered.reduce((latest, current) => (current > latest ? current : latest));
}

function sanitizeDestination(record: BackupDestinationRecord): ExtensionBackupDestinationStatus {
  const runtime = record.runtime;
  return {
    id: record.id,
    name: record.name,
    type: record.type,
    configured: isDestinationConfigured(record.type, record.destination),
    includeAttachments: record.includeAttachments,
    schedule: {
      enabled: record.schedule.enabled,
      intervalHours: record.schedule.intervalHours,
      startTime: record.schedule.startTime,
      timezone: record.schedule.timezone,
      retentionCount: record.schedule.retentionCount,
    },
    runtime: {
      lastAttemptAt: runtime.lastAttemptAt,
      lastAttemptLocalDate: runtime.lastAttemptLocalDate,
      lastSuccessAt: runtime.lastSuccessAt,
      lastErrorAt: runtime.lastErrorAt,
      lastUploadedFileName: runtime.lastUploadedFileName,
      lastUploadedSizeBytes: runtime.lastUploadedSizeBytes,
      lastErrorSummary: runtime.lastErrorAt ? 'Backup failed. Open go for details.' : null,
    },
  };
}

export function buildExtensionBackupStatus(
  settings: BackupSettings | null,
  state: ExtensionBackupState = settings ? 'available' : 'not_linked'
): ExtensionBackupStatusResponse {
  const destinations = settings?.destinations.map(sanitizeDestination) ?? [];
  return {
    object: 'go-extension-backup-status',
    state,
    checkedAt: nowIso(),
    destinations,
    summary: {
      destinationCount: destinations.length,
      configuredDestinationCount: destinations.filter((destination) => destination.configured).length,
      scheduledDestinationCount: destinations.filter((destination) => destination.schedule.enabled).length,
      healthyDestinationCount: destinations.filter(
        (destination) => !!destination.runtime.lastSuccessAt && !destination.runtime.lastErrorAt
      ).length,
      lastSuccessAt: pickLatestIso(destinations.map((destination) => destination.runtime.lastSuccessAt)),
      lastAttemptAt: pickLatestIso(destinations.map((destination) => destination.runtime.lastAttemptAt)),
      lastErrorAt: pickLatestIso(destinations.map((destination) => destination.runtime.lastErrorAt)),
    },
  };
}

export function buildExtensionImportStatus(state: ExtensionImportState = 'available'): ExtensionImportStatusResponse {
  return {
    object: 'go-extension-import-status',
    state,
    checkedAt: nowIso(),
    directImportFromExtension: false,
    route: '/backup/import-export',
    supportedSources: [...SUPPORTED_IMPORT_SOURCES],
  };
}

export function buildExtensionDeviceReadiness(
  input: ExtensionDeviceReadinessInput | null,
  state: ExtensionDeviceState = input ? 'available' : 'not_linked'
): ExtensionDeviceReadinessResponse {
  return {
    object: 'go-extension-device-readiness',
    state,
    checkedAt: nowIso(),
    directDeviceMutationFromExtension: false,
    route: '/security/devices',
    summary: {
      totalDeviceCount: input?.totalDeviceCount ?? 0,
      trustedDeviceCount: input?.trustedDeviceCount ?? 0,
      verifyDevicesEnabled: input?.verifyDevicesEnabled ?? false,
    },
  };
}
