import type { AppPhase, Profile, SessionState } from '@/lib/types';

const GO_VAULT_BROWSER_SESSION_EVENT = 'go-vault:browser-session:v1';

type ExtensionSessionState = 'signed_out' | 'locked' | 'unlocked';

interface PublishExtensionSessionStatusArgs {
  phase: AppPhase;
  session: SessionState | null;
  profile: Profile | null;
  route: string;
}

function browserSessionState(
  phase: AppPhase,
  session: SessionState | null,
): ExtensionSessionState {
  if (phase === 'locked') return 'locked';
  if (
    phase === 'app'
    && !!session?.accessToken
    && !!session?.symEncKey
    && !!session?.symMacKey
  ) {
    return 'unlocked';
  }
  return 'signed_out';
}

export function publishExtensionSessionStatus({
  phase,
  session,
  profile,
  route,
}: PublishExtensionSessionStatusArgs): void {
  if (typeof window === 'undefined') return;

  const origin = window.location.origin;
  const payload = {
    object: 'go-vault-browser-session',
    version: 1,
    origin,
    state: browserSessionState(phase, session),
    email: profile?.email || session?.email || null,
    role: profile?.role === 'admin' || profile?.role === 'user'
      ? profile.role
      : null,
    route: route || '/',
    checkedAt: new Date().toISOString(),
  } as const;

  window.postMessage(
    {
      type: GO_VAULT_BROWSER_SESSION_EVENT,
      payload,
    },
    origin,
  );
}
