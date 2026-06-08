/** Pure bearer-token guard for the internal code-exec endpoint.
 *  Kept in a dependency-free module so it is unit-testable without loading
 *  the @tanstack/ai-isolate-cloudflare worker (which references cloudflare: modules). */

/** Constant-ish bearer check. True only when token is set AND matches exactly. */
export function codeExecGuard(authHeader: string | undefined, token: string): boolean {
  if (!token) return false
  if (!authHeader?.startsWith("Bearer ")) return false
  return authHeader.slice(7) === token
}
