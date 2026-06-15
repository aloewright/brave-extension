# Go Vault Readiness Contract

Date: 2026-06-15
Status: Prototype — contract/readiness work only
Branch: cursor/go-vault-readiness-contract
Parent: [ALO-705](https://linear.app/aloey/issue/ALO-705/ai-dev-sidebar-complete-custom-go-password-manager-integration)

## Scope

This document defines the readiness contract that the Passwords panel uses to
decide which action to present the user. It is **not** a token handoff design
and does not introduce autofill.

The single question it answers: **given the current snapshot from the go bridge
and the browser session pulse, what should the extension UI show next?**

## Non-Goals

- Token or credential storage of any kind
- Passive autofill or auto-submit
- Per-domain password matching
- Unlock via the extension (unlock always opens the go webapp)

## State Machine

```
go unreachable           → action: "offline"
go reachable, no bridge  → action: "configure"
browser session: signed_out → action: "sign_in"   (route: /login)
browser session: locked     → action: "unlock"    (route: /login)
api session: not_linked     → action: "sign_in"   (route: /login)
api session: authenticated  → action: "open_vault" (route: /vault)
```

Browser session (from content-script pulse) takes priority over the api session
for the locked/signed_out states because it reflects the live in-tab state
without a network round-trip.

## GoVaultReadinessState

```typescript
export type GoVaultReadinessAction =
  | "open_vault"
  | "sign_in"
  | "unlock"
  | "configure"
  | "offline";

export interface GoVaultReadinessState {
  action: GoVaultReadinessAction;
  reachable: boolean;
  vaultRoute: string;        // the route to open on the primary button click
  backupHealthy: boolean | null;   // null when not admin or not linked
  importAvailable: boolean;
}
```

## Secret Exclusion Contract

`GoVaultReadinessState` must never carry:

- `accessToken`, `refreshToken`, `token`, `secret`
- `password`, `masterKey`
- `cipher`, `key`, `webdavPassword`
- `email`, `role` (strip before returning — UI derives avatar from elsewhere)

The `assertNoSecretsInReadiness` guard in `go-vault-readiness.ts` enforces this
at test time. The panel must call `deriveGoVaultReadiness` and render only from
`GoVaultReadinessState`, never from the raw bridge snapshot.

## Backup Health

Backup health is only surfaced when:

1. The api session confirms `canManageBackups: true` (admin role)
2. The backup state is `"available"` (not `"not_linked"` or `"needs_reactivation"`)
3. At least one destination is configured

A `healthyDestinationCount === destinationCount` check is sufficient. The panel
shows a warning card on `backupHealthy === false`; non-admin users see
`backupHealthy === null` and no backup card.

## Relation to Merged Swarm Plan

`docs/password-next-phase-swarm-plan.md` (merged via PR #131/#132) defines the
four API endpoints and the `GoVaultBridgeSnapshot` shape. This document focuses
on the single derivation step on top: snapshot → UI action.

No new API endpoints are introduced here. The readiness helper consumes the
existing `GoVaultBridgeSnapshot` from `checkGoVaultBridge` and the
`GoVaultBrowserSessionStatus` from `readGoVaultBrowserSessionStatus`.

## Deferred

- Route parameters beyond `vaultRoute` (backup, import, devices) are available
  in `snapshot.publicStatus.routes`; the panel can read them directly when
  building secondary buttons. They are excluded from `GoVaultReadinessState`
  to keep the surface minimal.
- Entry-point priority when browser session and api session disagree will be
  resolved in the panel UI slice, not here.
