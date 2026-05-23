import { useEffect, useMemo, useState, type ReactNode } from "react"
import { LeoBadge, LeoButton, LeoIcon, LeoIconButton } from "../../../components/leo"

import {
  analyzeCookie,
  cookieMatchesHost,
  sameSiteLabel,
  type CookieRisk
} from "../utils/cookies"
import { companyNameForDomain, normalizeHostname } from "../../../lib/company-names"
import {
  THIRD_PARTY_COOKIE_GRANTS_KEY,
  type ThirdPartyCookieGrant,
  type ThirdPartyCookieState
} from "../../../lib/third-party-cookie-types"

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`animate-spin ${className}`}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}

interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
  hostOnly: boolean
  storeId?: string
  expirationDate?: number
}

interface ActiveSite {
  origin: string
  hostname: string
  label: string
}

type ClearKey = "cache" | "history" | "all" | "cookies" | "site"

function cookieKey(cookie: CookieEntry) {
  return `${cookie.storeId || "default"}:${cookie.domain}:${cookie.path}:${cookie.name}`
}

function cookieUrl(cookie: CookieEntry) {
  const protocol = cookie.secure ? "https" : "http"
  const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
  const path = cookie.path.startsWith("/") ? cookie.path : `/${cookie.path}`

  return `${protocol}://${domain}${path}`
}

async function removeCookie(cookie: CookieEntry) {
  await chrome.cookies.remove({
    url: cookieUrl(cookie),
    name: cookie.name,
    ...(cookie.storeId ? { storeId: cookie.storeId } : {})
  })
}

function formatExpiration(cookie: CookieEntry) {
  if (!cookie.expirationDate) return "Session"

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(cookie.expirationDate * 1000))
}

function truncateValue(value: string) {
  if (!value) return "(empty)"
  if (value.length <= 80) return value
  return `${value.slice(0, 77)}...`
}

function riskClass(risk: CookieRisk) {
  if (risk === "high") return "bg-red-500/15 text-red-400 border-red-500/35"
  if (risk === "medium") return "bg-warning/10 text-warning border-warning/20"
  return "bg-success/10 text-success border-success/20"
}

function categoryClass(category: string) {
  if (category === "Marketing") return "bg-destructive/10 text-destructive border-destructive/20"
  if (category === "Analytics") return "bg-warning/10 text-warning border-warning/20"
  if (category === "Auth/session") return "bg-success/10 text-success border-success/20"
  if (category === "A/B testing") return "bg-info/10 text-info border-info/20"
  if (category === "Preference") return "bg-primary/10 text-primary border-primary/20"
  return "bg-fg/5 text-fg/50 border-border"
}

function CookieBadge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <LeoBadge className={className}>
      {children}
    </LeoBadge>
  )
}

function RiskBadge({ risk, count }: { risk: CookieRisk; count?: number }) {
  const label =
    risk === "high" ? "High concern" : risk === "medium" ? "Medium concern" : "Low concern"
  const marker = risk === "high" ? "!" : risk === "medium" ? <LeoIcon name="warning-triangle-outline" size={10} /> : "low"

  return (
    <CookieBadge className={riskClass(risk)}>
      <span title={label} aria-label={label} className="inline-flex items-center gap-1">
        {count !== undefined ? (
          <>
            <span>{count}</span>
            {marker}
          </>
        ) : marker}
      </span>
    </CookieBadge>
  )
}

function riskSummary(count: number, risk: CookieRisk) {
  if (count === 0) return ""
  const marker = risk === "high" ? "!" : risk === "medium" ? "⚠" : "low"
  return `, ${count} ${marker}`
}

function CookieRow({ cookie, onDelete }: { cookie: CookieEntry; onDelete: (cookie: CookieEntry) => void }) {
  const insight = analyzeCookie(cookie)
  const companyName = companyNameForDomain(cookie.domain)

  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-medium break-all">{cookie.name}</h4>
            <CookieBadge className={categoryClass(insight.category)}>{insight.category}</CookieBadge>
            <RiskBadge risk={insight.risk} />
          </div>
          <p className="text-[11px] text-fg/40 mt-1">
            {companyName} cookie
            {cookie.path && cookie.path !== "/" ? `, path-scoped` : ""}
          </p>
        </div>
        <LeoIconButton
          onClick={() => onDelete(cookie)}
          title={`Delete ${cookie.name}`}
          aria-label={`Delete ${cookie.name}`}
          className="flex-shrink-0 text-destructive hover:bg-destructive/10"
          icon="trash"
          iconSize={13}
          variant="ghost"
        />
      </div>

      <code
        className="block text-[11px] text-fg/45 bg-bg/60 border border-border rounded px-2 py-1.5 mt-3 break-all"
        title={cookie.value}>
        {truncateValue(cookie.value)}
      </code>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3">
        <div className="rounded border border-border bg-bg/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-fg/35">{insight.scopeLabel}</div>
          <p className="text-[11px] text-fg/65 mt-1 leading-relaxed">{insight.scopeDescription}</p>
        </div>
        <div className="rounded border border-border bg-bg/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-fg/35">{insight.sendingLabel}</div>
          <p className="text-[11px] text-fg/65 mt-1 leading-relaxed">{insight.sendingDescription}</p>
        </div>
        <div className="rounded border border-border bg-bg/40 p-2">
          <div className="text-[10px] uppercase tracking-wide text-fg/35">Recommendation</div>
          <p className="text-[11px] text-fg/65 mt-1 leading-relaxed">{insight.recommendation}</p>
        </div>
      </div>

      <div className="flex gap-1.5 mt-3 flex-wrap">
        {cookie.secure && <CookieBadge className="bg-success/10 text-success border-success/20">Secure</CookieBadge>}
        {cookie.httpOnly && <CookieBadge className="bg-info/10 text-info border-info/20">HttpOnly</CookieBadge>}
        <CookieBadge className="bg-fg/5 text-fg/50 border-border">{sameSiteLabel(cookie)}</CookieBadge>
        <CookieBadge className="bg-fg/5 text-fg/50 border-border">{formatExpiration(cookie)}</CookieBadge>
      </div>
    </div>
  )
}

export function CookiesSection() {
  const [cookies, setCookies] = useState<CookieEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null)
  const [currentSiteOnly, setCurrentSiteOnly] = useState(false)
  const [activeSite, setActiveSite] = useState<ActiveSite | null>(null)
  const [thirdPartyCookieState, setThirdPartyCookieState] = useState<ThirdPartyCookieState>({
    protectedByDefault: true,
    grants: []
  })
  const [expandedDomains, setExpandedDomains] = useState<Set<string>>(() => new Set())
  const [clearing, setClearing] = useState<ClearKey | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2500)
  }

  const fetchCookies = async () => {
    setLoading(true)
    const all = await chrome.cookies.getAll({})
    const mapped: CookieEntry[] = all.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite || "unspecified",
      hostOnly: c.hostOnly ?? !c.domain.startsWith("."),
      storeId: c.storeId,
      expirationDate: c.expirationDate
    }))

    mapped.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
    setCookies(mapped)
    setLoading(false)
  }

  const fetchActiveSite = async () => {
    try {
      if (!chrome.tabs?.query) {
        setActiveSite(null)
        return
      }

      let query: chrome.tabs.QueryInfo = { active: true, currentWindow: true }

      try {
        const focusedWindow = await chrome.windows?.getLastFocused({ windowTypes: ["normal"] })
        if (typeof focusedWindow?.id === "number") {
          query = { active: true, windowId: focusedWindow.id }
        }
      } catch {
        // Falling back to the current extension window is still better than
        // hiding the site filter entirely.
      }

      const [tab] = await chrome.tabs.query(query)
      if (!tab?.url) {
        setActiveSite(null)
        return
      }

      const url = new URL(tab.url)
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        setActiveSite(null)
        return
      }

      setActiveSite({
        origin: url.origin,
        hostname: url.hostname,
        label: tab.title || url.hostname
      })
    } catch {
      setActiveSite(null)
    }
  }

  const fetchThirdPartyCookieState = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "thirdPartyCookies:getState" })
      if (response?.grants) setThirdPartyCookieState(response)
    } catch {
      setThirdPartyCookieState({ protectedByDefault: false, grants: [] })
    }
  }

  useEffect(() => {
    void fetchCookies()
    void fetchActiveSite()
    void fetchThirdPartyCookieState()
  }, [])

  useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local" || !changes[THIRD_PARTY_COOKIE_GRANTS_KEY]) return
      void fetchThirdPartyCookieState()
    }
    chrome.storage?.onChanged?.addListener(listener)
    return () => chrome.storage?.onChanged?.removeListener(listener)
  }, [])

  const domains = useMemo(
    () => Array.from(new Set(cookies.map((c) => c.domain))).sort(),
    [cookies]
  )

  const currentSiteCookies = useMemo(
    () => activeSite ? cookies.filter((c) => cookieMatchesHost(c, activeSite.hostname)) : [],
    [activeSite, cookies]
  )

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()

    return cookies.filter((cookie) => {
      if (selectedDomain && cookie.domain !== selectedDomain) return false
      if (currentSiteOnly && activeSite && !cookieMatchesHost(cookie, activeSite.hostname)) return false
      if (currentSiteOnly && !activeSite) return false
      if (!query) return true

      return (
        cookie.name.toLowerCase().includes(query) ||
        cookie.domain.toLowerCase().includes(query) ||
        cookie.value.toLowerCase().includes(query)
      )
    })
  }, [activeSite, cookies, currentSiteOnly, search, selectedDomain])

  const grouped = useMemo(() => {
    const groups = new Map<string, CookieEntry[]>()
    for (const cookie of filtered) {
      const existing = groups.get(cookie.domain) || []
      existing.push(cookie)
      groups.set(cookie.domain, existing)
    }

    return Array.from(groups.entries()).map(([domain, entries]) => ({
      domain,
      entries,
      highRisk: entries.filter((cookie) => analyzeCookie(cookie).risk === "high").length,
      mediumRisk: entries.filter((cookie) => analyzeCookie(cookie).risk === "medium").length
    }))
  }, [filtered])

  const deleteCookie = async (cookie: CookieEntry) => {
    await removeCookie(cookie)
    setCookies((prev) => prev.filter((entry) => cookieKey(entry) !== cookieKey(cookie)))
    showToast(`Deleted ${cookie.name}`)
  }

  const deleteAllForDomain = async (domain: string) => {
    const domainCookies = cookies.filter((c) => c.domain === domain)
    await Promise.all(domainCookies.map(removeCookie))
    setCookies((prev) => prev.filter((c) => c.domain !== domain))
    showToast(`Deleted ${domainCookies.length} cookies for ${companyNameForDomain(domain)}`)
    if (selectedDomain === domain) setSelectedDomain(null)
  }

  // Wrap a clear action so the spinner state is always restored on error and
  // fast actions still show a readable "clearing" frame.
  const runClear = async (key: ClearKey, fn: () => Promise<unknown>, doneMsg: string) => {
    if (clearing) return
    setClearing(key)
    const startedAt = Date.now()

    try {
      await fn()
      const elapsed = Date.now() - startedAt
      if (elapsed < 600) await new Promise((resolve) => window.setTimeout(resolve, 600 - elapsed))
      showToast(doneMsg)
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setClearing(null)
    }
  }

  // chrome.browsingData requires manifest permission and may be unavailable
  // until the extension is reloaded after an install/update.
  const requireBrowsingData = () => {
    if (typeof chrome === "undefined" || !chrome.browsingData) {
      throw new Error("chrome.browsingData unavailable - reload the extension")
    }
  }

  const clearCache = () =>
    runClear("cache", async () => {
      requireBrowsingData()
      await chrome.browsingData.removeCache({})
    }, "Cache cleared")

  const clearHistory = () =>
    runClear("history", async () => {
      requireBrowsingData()
      await chrome.browsingData.removeHistory({})
    }, "History cleared")

  const clearCurrentSiteData = () =>
    runClear("site", async () => {
      if (!activeSite) throw new Error("Open a regular http or https tab first")
      requireBrowsingData()

      const siteCookies = cookies.filter((cookie) => cookieMatchesHost(cookie, activeSite.hostname))
      await Promise.all([
        chrome.browsingData.remove({ origins: [activeSite.origin] }, { cache: true }),
        Promise.all(siteCookies.map(removeCookie))
      ])

      setSelectedDomain(null)
      setCurrentSiteOnly(true)
      await fetchCookies()
    }, `Cleared cache and ${currentSiteCookies.length} cookies for ${activeSiteCompany || "this site"}`)

  const deleteAllCookies = () =>
    runClear("cookies", async () => {
      if (chrome.browsingData?.removeCookies) {
        await chrome.browsingData.removeCookies({})
      } else {
        await Promise.all(cookies.map(removeCookie))
      }
      setCookies([])
      setSelectedDomain(null)
      setCurrentSiteOnly(false)
      await fetchCookies()
    }, "All cookies deleted")

  const clearAll = () =>
    runClear("all", async () => {
      requireBrowsingData()
      await Promise.all([
        chrome.browsingData.removeCache({}),
        chrome.browsingData.removeHistory({}),
        chrome.browsingData.removeCookies({}),
        chrome.browsingData.removeLocalStorage({})
      ])
      setCookies([])
      setSelectedDomain(null)
      setCurrentSiteOnly(false)
      await fetchCookies()
    }, "All browsing data cleared")

  const refresh = async () => {
    await Promise.all([fetchCookies(), fetchActiveSite(), fetchThirdPartyCookieState()])
    showToast("Cookie view refreshed")
  }

  const activeSiteCompany = activeSite ? companyNameForDomain(activeSite.hostname) : null

  const grantForDomain = (domain: string): ThirdPartyCookieGrant | null => {
    if (!activeSite) return null
    const siteDomain = normalizeHostname(activeSite.hostname)
    const embeddedDomain = normalizeHostname(domain)
    return thirdPartyCookieState.grants.find((grant) =>
      grant.siteDomain === siteDomain && grant.embeddedDomain === embeddedDomain
    ) || null
  }

  const openThirdPartyCookiePrompt = async (domain: string) => {
    if (!activeSite) return
    const embeddedName = companyNameForDomain(domain)
    try {
      const response = await chrome.runtime.sendMessage({
        type: "thirdPartyCookies:openGrantPrompt",
        payload: {
          siteDomain: activeSite.hostname,
          embeddedDomain: domain
        }
      })
      if (response?.ok === false) {
        showToast(`Failed: ${response.error || "could not open permission popup"}`)
        return
      }
      showToast(`Permission popup opened for ${embeddedName}`)
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const revokeThirdPartyCookieGrant = async (grant: ThirdPartyCookieGrant) => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: "thirdPartyCookies:revokeGrant",
        id: grant.id
      })
      if (response?.ok === false) {
        showToast(`Failed: ${response.error || "could not revoke permission"}`)
        return
      }
      await fetchThirdPartyCookieState()
      showToast(`Blocked ${grant.embeddedName} on ${grant.siteName}`)
    } catch (err) {
      showToast(`Failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const toggleDomain = (domain: string) => {
    setExpandedDomains((prev) => {
      const next = new Set(prev)
      if (next.has(domain)) next.delete(domain)
      else next.add(domain)
      return next
    })
  }

  const expandAll = () => setExpandedDomains(new Set(grouped.map((group) => group.domain)))
  const collapseAll = () => setExpandedDomains(new Set())

  return (
    <div className="relative">
      {toast && (
        <div
          className={`fixed top-4 right-4 z-50 text-xs py-2 px-4 rounded animate-fade-in ${
            toast.startsWith("Failed")
              ? "bg-destructive/20 text-destructive"
              : "bg-success/20 text-success"
          }`}>
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-lg font-semibold">Data</h2>
          <p className="text-xs text-fg/40 mt-0.5">
            {cookies.length} cookies across {domains.length} companies
          </p>
        </div>
        <div className="flex gap-2">
          <LeoButton
            onClick={refresh}
            disabled={clearing !== null || loading}
            variant="ghost">
            Refresh
          </LeoButton>
          <LeoButton
            onClick={deleteAllCookies}
            disabled={clearing !== null}
            aria-busy={clearing === "cookies"}
            variant="danger">
            {clearing === "cookies" && <Spinner className="w-3.5 h-3.5" />}
            {clearing === "cookies" ? "Deleting..." : "Delete All Cookies"}
          </LeoButton>
        </div>
      </div>

      <div className="rounded-lg bg-card border border-border p-3 mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Current tab</h3>
            {activeSite ? (
              <>
                <p className="text-xs text-fg/55 mt-1 truncate" title={activeSite.label}>
                  {activeSiteCompany}
                </p>
                <p className="text-[11px] text-fg/35 mt-1">
                  {currentSiteCookies.length} cookies match this company. Cache clearing is scoped to the current site.
                </p>
                <p className="text-[11px] text-fg/35 mt-1">
                  Third-party cookie access is blocked by default and only allowed after a popup approval.
                </p>
              </>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 justify-end">
            <LeoButton
              onClick={() => {
                setSelectedDomain(null)
                setCurrentSiteOnly(true)
              }}
              disabled={!activeSite}
              active={currentSiteOnly}
              variant="primary">
              Show current site
            </LeoButton>
            <LeoButton
              onClick={clearCurrentSiteData}
              disabled={!activeSite || clearing !== null}
              aria-busy={clearing === "site"}
              variant="danger">
              {clearing === "site" && <Spinner className="w-3.5 h-3.5" />}
              {clearing === "site" ? "Clearing..." : "Clear site cache + cookies"}
            </LeoButton>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-5">
        <button
          onClick={clearCache}
          disabled={clearing !== null}
          aria-busy={clearing === "cache"}
          className="p-4 rounded-lg bg-card border border-border hover:border-success/40 transition-colors text-center group disabled:opacity-50 disabled:cursor-not-allowed">
          {clearing === "cache" ? (
            <Spinner className="mx-auto mb-2 text-success" />
          ) : (
            <LeoIcon name="globe" size={24} className="mx-auto mb-2 text-fg/40 group-hover:text-success transition-colors" />
          )}
          <span className="text-sm font-medium transition-colors">{clearing === "cache" ? "Clearing..." : "Clear Cache"}</span>
        </button>

        <button
          onClick={clearHistory}
          disabled={clearing !== null}
          aria-busy={clearing === "history"}
          className="p-4 rounded-lg bg-card border border-border hover:border-info/40 transition-colors text-center group disabled:opacity-50 disabled:cursor-not-allowed">
          {clearing === "history" ? (
            <Spinner className="mx-auto mb-2 text-info" />
          ) : (
            <LeoIcon name="history" size={24} className="mx-auto mb-2 text-fg/40 group-hover:text-info transition-colors" />
          )}
          <span className="text-sm font-medium transition-colors">{clearing === "history" ? "Clearing..." : "Clear History"}</span>
        </button>

        <button
          onClick={clearAll}
          disabled={clearing !== null}
          aria-busy={clearing === "all"}
          className="p-4 rounded-lg bg-card border border-destructive/30 hover:border-destructive/60 transition-colors text-center group disabled:opacity-50 disabled:cursor-not-allowed">
          {clearing === "all" ? (
            <Spinner className="mx-auto mb-2 text-destructive" />
          ) : (
            <LeoIcon name="trash" size={24} className="mx-auto mb-2 text-fg/40 group-hover:text-destructive transition-colors" />
          )}
          <span className="text-sm font-medium text-destructive/80 transition-colors">{clearing === "all" ? "Clearing..." : "Clear Everything"}</span>
          <p className="text-[10px] text-fg/20 mt-0.5">Cache + history + cookies + storage</p>
        </button>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search cookies by name, company, or value..."
          className="min-w-0 flex-1 text-sm py-2 px-3 rounded bg-card border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 transition-colors"
        />
        <LeoButton
          onClick={() => {
            setSelectedDomain(null)
            setCurrentSiteOnly(false)
          }}
          active={!selectedDomain && !currentSiteOnly}
          size="md"
          variant="primary">
          All
        </LeoButton>
      </div>

      <div className="flex gap-1 mb-4 flex-wrap max-h-20 overflow-y-auto">
        {activeSite && (
          <LeoButton
            onClick={() => {
              setSelectedDomain(null)
              setCurrentSiteOnly(true)
            }}
            active={currentSiteOnly}
            size="xs"
            variant="primary">
            Current site ({currentSiteCookies.length})
          </LeoButton>
        )}
        {domains.map((domain) => (
          <LeoButton
            key={domain}
            onClick={() => {
              setSelectedDomain(domain)
              setCurrentSiteOnly(false)
              setExpandedDomains((prev) => new Set(prev).add(domain))
            }}
            active={selectedDomain === domain}
            size="xs"
            variant="primary">
            {companyNameForDomain(domain)}
          </LeoButton>
        ))}
      </div>

      {(selectedDomain || currentSiteOnly) && (
        <div className="flex items-center justify-between mb-3 p-2 rounded bg-primary/5 border border-primary/20">
          <span className="text-xs text-primary">
            Showing {currentSiteOnly ? `cookies for ${activeSiteCompany}` : companyNameForDomain(selectedDomain || "")}
          </span>
          <LeoButton
            onClick={() => {
              setSelectedDomain(null)
              setCurrentSiteOnly(false)
            }}
            size="xs"
            variant="ghost">
            Clear filter
          </LeoButton>
        </div>
      )}

      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-fg/40">
          {filtered.length} matching cookies grouped into {grouped.length} companies
        </p>
        <div className="flex gap-1">
          <LeoIconButton
            onClick={expandAll}
            title="Expand all"
            aria-label="Expand all"
            icon="chevrons-down"
            iconSize={13}
            size="icon-sm"
            variant="ghost"
          />
          <LeoIconButton
            onClick={collapseAll}
            title="Collapse all"
            aria-label="Collapse all"
            icon="chevrons-up"
            iconSize={13}
            size="icon-sm"
            variant="ghost"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 text-fg/40">
          <Spinner />
          <p className="text-sm mt-3">Loading cookies...</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="text-center py-16 text-fg/30">
          <p className="text-sm">No cookies match this filter.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map((group) => {
            const expanded = currentSiteOnly || selectedDomain === group.domain || expandedDomains.has(group.domain)
            const companyName = companyNameForDomain(group.domain)
            const thirdPartyForActiveSite = !!activeSite && !group.entries.some((cookie) => cookieMatchesHost(cookie, activeSite.hostname))
            const grant = thirdPartyForActiveSite ? grantForDomain(group.domain) : null

            return (
              <section key={group.domain} className="rounded-lg border border-border bg-card/50 overflow-hidden">
                <div className="flex items-stretch">
                  <button
                    onClick={() => toggleDomain(group.domain)}
                    className="min-w-0 flex-1 flex items-center justify-between gap-3 text-left p-3 hover:bg-bg/40 transition-colors">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-fg/40 text-xs w-4">{expanded ? "v" : ">"}</span>
                        <h3 className="text-sm font-medium truncate">{companyName}</h3>
                      </div>
                      <p className="text-[11px] text-fg/35 mt-1">
                        {group.entries.length} cookies
                        {riskSummary(group.highRisk, "high")}
                        {riskSummary(group.mediumRisk, "medium")}
                        {thirdPartyForActiveSite && (grant ? ", allowed on this site" : ", blocked on this site")}
                      </p>
                    </div>
                    <div className="flex gap-1 flex-wrap justify-end">
                      {group.highRisk > 0 && <RiskBadge risk="high" count={group.highRisk} />}
                      {group.mediumRisk > 0 && <RiskBadge risk="medium" count={group.mediumRisk} />}
                    </div>
                  </button>
                  {thirdPartyForActiveSite && (
                    grant ? (
                      <LeoIconButton
                        onClick={() => revokeThirdPartyCookieGrant(grant)}
                        title={`Third-party cookies allowed for ${companyName}. Click to block again.`}
                        aria-label={`Third-party cookies allowed for ${companyName}. Click to block again.`}
                        className="self-stretch rounded-none border-l border-border text-success hover:bg-success/10"
                        icon="check-normal"
                        iconSize={14}
                        size="icon-md"
                        variant="ghost"
                      />
                    ) : (
                      <LeoIconButton
                        onClick={() => openThirdPartyCookiePrompt(group.domain)}
                        title={`Open popup to allow third-party cookies for ${companyName}`}
                        aria-label={`Open popup to allow third-party cookies for ${companyName}`}
                        className="self-stretch rounded-none border-l border-border text-primary hover:bg-primary/10"
                        icon="eye-on"
                        iconSize={14}
                        size="icon-md"
                        variant="ghost"
                      />
                    )
                  )}
                  <LeoIconButton
                    onClick={() => deleteAllForDomain(group.domain)}
                    title={`Delete ${companyName} cookies`}
                    aria-label={`Delete ${companyName} cookies`}
                    className="rounded-none border-l border-border text-destructive hover:bg-destructive/10"
                    icon="close"
                    iconSize={14}
                    size="icon-md"
                    variant="ghost"
                  />
                </div>
                {expanded && (
                  <div className="border-t border-border p-3 space-y-2 bg-bg/25">
                    {group.entries.map((cookie) => (
                      <CookieRow key={cookieKey(cookie)} cookie={cookie} onDelete={deleteCookie} />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
