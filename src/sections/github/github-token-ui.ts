// Mirrors pickSecretValue / secret-name-candidates pattern from SettingsSection.
export const GH_TOKEN_SECRET_NAMES = ["GITHUB_PAT", "GITHUB_TOKEN", "GH_TOKEN", "GH_PAT"]

export function pickGitHubToken(secrets: Record<string, string>): string {
  const normalized = Object.entries(secrets).reduce<Record<string, string>>(
    (acc, [k, v]) => { acc[k.trim().toUpperCase()] = v; return acc },
    {}
  )
  for (const name of GH_TOKEN_SECRET_NAMES) {
    const hit = normalized[name]
    if (typeof hit === "string" && hit.trim()) return hit.trim()
  }
  return ""
}
