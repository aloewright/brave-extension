import { LIMITS } from '../config/limits';
import {
  buildExtensionBackupStatus,
  buildExtensionImportStatus,
  buildExtensionPublicStatus,
  buildExtensionSessionStatus,
  type ExtensionJwtUnsafeReason,
} from '../extension-bridge-contract';
import { loadBackupSettings } from '../services/backup-config';
import { StorageService } from '../services/storage';
import { DEFAULT_DEV_SECRET, type Env, type User } from '../types';
import { errorResponse, jsonResponse } from '../utils/response';

function jwtSecretUnsafeReason(env: Env): ExtensionJwtUnsafeReason {
  const secret = (env.JWT_SECRET || '').trim();
  if (!secret) return 'missing';
  if (secret === DEFAULT_DEV_SECRET) return 'default';
  if (secret.length < LIMITS.auth.jwtSecretMinLength) return 'too_short';
  return null;
}

export async function handlePublicExtensionStatus(env: Env): Promise<Response> {
  const storage = new StorageService(env.DB);
  const userCount = await storage.getUserCount();
  const bootstrapInviteCodeRequired = Boolean(String(env.BOOTSTRAP_INVITE_CODE || '').trim());

  return jsonResponse(
    buildExtensionPublicStatus({
      version: LIMITS.compatibility.bitwardenServerVersion,
      jwtUnsafeReason: jwtSecretUnsafeReason(env),
      jwtSecretMinLength: LIMITS.auth.jwtSecretMinLength,
      registrationInviteRequired: bootstrapInviteCodeRequired || userCount > 0,
    })
  );
}

export async function handleAuthenticatedExtensionRoute(
  request: Request,
  env: Env,
  currentUser: User,
  path: string,
  method: string
): Promise<Response | null> {
  void request;

  if (!path.startsWith('/api/extension/')) return null;
  if (method !== 'GET') return errorResponse('Method not allowed', 405);

  if (path === '/api/extension/session') {
    return jsonResponse(buildExtensionSessionStatus(currentUser));
  }

  if (path === '/api/extension/import/status') {
    return jsonResponse(buildExtensionImportStatus('available'));
  }

  if (path === '/api/extension/backup/status') {
    if (currentUser.role !== 'admin') {
      return jsonResponse(buildExtensionBackupStatus(null, 'not_admin'));
    }

    const storage = new StorageService(env.DB);
    try {
      const settings = await loadBackupSettings(storage, env, 'UTC');
      return jsonResponse(buildExtensionBackupStatus(settings, 'available'));
    } catch {
      return jsonResponse(buildExtensionBackupStatus(null, 'needs_reactivation'));
    }
  }

  return null;
}
