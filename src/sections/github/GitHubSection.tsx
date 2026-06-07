import { useMemo, useState } from "react"
import { useSettings } from "../../hooks/useSettings"
import { useNativeHost } from "../../hooks/useNativeHost"
import { setToken } from "../../lib/github/token"
import { FEATURES, type FeatureCategory, type FeatureMeta } from "../../lib/github/registry"
import { GH_TOKEN_SECRET_NAMES, pickGitHubToken } from "./github-token-ui"

const CATEGORY_LABELS: Record<FeatureCategory, string> = {
  global: "Global",
  repository: "Repository",
  "pull-requests": "Pull Requests",
  issues: "Issues",
  profiles: "Profiles",
  "write-actions": "Write actions"
}
const CATEGORY_ORDER: FeatureCategory[] = [
  "global", "repository", "pull-requests", "issues", "profiles", "write-actions"
]

export function GitHubSection() {
  const { settings, update } = useSettings()
  const [tokenStatus, setTokenStatus] = useState<string | null>(null)
  const nativeHost = useNativeHost({
    onDopplerRpcResult: (msg) => {
      if (msg.type !== "doppler.secrets.download") return
      if (!msg.ok) {
        setTokenStatus(`Doppler: ${msg.error || "failed to load secrets"}`)
        return
      }
      const token = pickGitHubToken(msg.secrets || {})
      void setToken(token)
      setTokenStatus(token ? "GitHub token loaded." : "No GitHub token found in Doppler.")
    }
  })
  const grouped = useMemo(() => {
    const map = new Map<FeatureCategory, FeatureMeta[]>()
    for (const f of FEATURES) {
      const list = map.get(f.category) ?? []
      list.push(f)
      map.set(f.category, list)
    }
    return map
  }, [])

  if (!settings) return null
  const gh = settings.github

  const isOn = (f: FeatureMeta) => gh.features[f.id] ?? f.defaultEnabled
  const toggleFeature = (id: string, value: boolean) =>
    update({ github: { ...gh, features: { ...gh.features, [id]: value } } })
  const toggleMaster = (value: boolean) =>
    update({ github: { ...gh, enabled: value } })

  const loadToken = () =>
    nativeHost.dopplerSecretsDownload({ secrets: GH_TOKEN_SECRET_NAMES })

  return (
    <div className="flex flex-col gap-4 overflow-y-auto p-4 text-sm">
      <header className="flex items-center justify-between">
        <h2 className="text-base font-semibold">GitHub Refinements</h2>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={gh.enabled}
            onChange={(e) => toggleMaster(e.target.checked)}
          />
          <span>Enabled</span>
        </label>
      </header>

      <section className="rounded border border-border p-3">
        <div className="flex items-center justify-between">
          <span>GitHub token (Doppler)</span>
          <button className="rounded bg-muted px-2 py-1" onClick={loadToken}>
            Load from Doppler
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-fg">
          Resolved from {GH_TOKEN_SECRET_NAMES.join(", ")}. Required for API and
          write features. Write actions need <code>repo</code> (and{" "}
          <code>delete_repo</code> for repository deletion) scopes.
        </p>
        {tokenStatus && (
          <p className="mt-1 text-xs text-fg" role="status">{tokenStatus}</p>
        )}
      </section>

      <div className={gh.enabled ? "" : "pointer-events-none opacity-50"}>
        {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
          <section key={category} className="mb-4">
            <h3
              className={
                "mb-2 text-xs font-semibold uppercase tracking-wide " +
                (category === "write-actions" ? "text-amber-500" : "text-muted-fg")
              }
            >
              {CATEGORY_LABELS[category]}
              {category === "write-actions" && " — these modify GitHub"}
            </h3>
            <ul className="flex flex-col gap-2">
              {grouped.get(category)!.map((f) => (
                <li key={f.id} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{f.name}</span>
                      {f.needsToken && (
                        <span className="rounded bg-blue-500/20 px-1 text-[10px] text-blue-400">
                          API
                        </span>
                      )}
                      {f.isWrite && (
                        <span className="rounded bg-amber-500/20 px-1 text-[10px] text-amber-500">
                          WRITE{f.writeScopes ? ` · ${f.writeScopes.join(" ")}` : ""}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-fg">{f.description}</p>
                  </div>
                  <input
                    type="checkbox"
                    aria-label={f.name}
                    checked={isOn(f)}
                    onChange={(e) => toggleFeature(f.id, e.target.checked)}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
