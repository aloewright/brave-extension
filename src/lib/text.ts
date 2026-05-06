// Tiny text helpers shared across the sidepanel UI.

/** Truncate a string to at most `n` characters, replacing the tail with `…`. */
export function truncate(s: string, n: number): string {
  if (!s) return ""
  return s.length > n ? s.slice(0, n - 1) + "…" : s
}
