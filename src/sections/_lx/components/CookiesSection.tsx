import { useEffect, useState } from "react"

interface CookieEntry {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: string
  expirationDate?: number
}

export function CookiesSection() {
  const [cookies, setCookies] = useState<CookieEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [selectedDomain, setSelectedDomain] = useState<string | null>(null)
  const [clearing, setClearing] = useState<"cache" | "history" | "all" | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
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
      sameSite: c.sameSite,
      expirationDate: c.expirationDate
    }))
    mapped.sort((a, b) => a.domain.localeCompare(b.domain) || a.name.localeCompare(b.name))
    setCookies(mapped)
    setLoading(false)
  }

  useEffect(() => { fetchCookies() }, [])

  const domains = Array.from(new Set(cookies.map((c) => c.domain))).sort()

  let filtered = cookies.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.domain.toLowerCase().includes(search.toLowerCase()) ||
    c.value.toLowerCase().includes(search.toLowerCase())
  )
  if (selectedDomain) filtered = filtered.filter((c) => c.domain === selectedDomain)

  const deleteCookie = async (cookie: CookieEntry) => {
    const protocol = cookie.secure ? "https" : "http"
    const domain = cookie.domain.startsWith(".") ? cookie.domain.slice(1) : cookie.domain
    await chrome.cookies.remove({
      url: `${protocol}://${domain}${cookie.path}`,
      name: cookie.name
    })
    setCookies((prev) => prev.filter((c) => !(c.name === cookie.name && c.domain === cookie.domain && c.path === cookie.path)))
    showToast(`Deleted ${cookie.name}`)
  }

  const deleteAllForDomain = async (domain: string) => {
    const domainCookies = cookies.filter((c) => c.domain === domain)
    await Promise.all(domainCookies.map((c) => {
      const protocol = c.secure ? "https" : "http"
      const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain
      return chrome.cookies.remove({ url: `${protocol}://${d}${c.path}`, name: c.name })
    }))
    setCookies((prev) => prev.filter((c) => c.domain !== domain))
    showToast(`Deleted ${domainCookies.length} cookies for ${domain}`)
    if (selectedDomain === domain) setSelectedDomain(null)
  }

  const deleteAllCookies = async () => {
    await Promise.all(cookies.map((c) => {
      const protocol = c.secure ? "https" : "http"
      const d = c.domain.startsWith(".") ? c.domain.slice(1) : c.domain
      return chrome.cookies.remove({ url: `${protocol}://${d}${c.path}`, name: c.name })
    }))
    setCookies([])
    setSelectedDomain(null)
    showToast("All cookies deleted")
  }

  const clearCache = async () => {
    setClearing("cache")
    await chrome.browsingData.removeCache({})
    setClearing(null)
    showToast("Cache cleared")
  }

  const clearHistory = async () => {
    setClearing("history")
    await chrome.browsingData.removeHistory({})
    setClearing(null)
    showToast("History cleared")
  }

  const clearAll = async () => {
    setClearing("all")
    await Promise.all([
      chrome.browsingData.removeCache({}),
      chrome.browsingData.removeHistory({}),
      chrome.browsingData.removeCookies({}),
      chrome.browsingData.removeLocalStorage({})
    ])
    setCookies([])
    setSelectedDomain(null)
    setClearing(null)
    showToast("All browsing data cleared")
  }

  return (
    <div className="relative">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 text-xs py-2 px-4 rounded bg-chart-1/20 text-chart-1 animate-fade-in">
          {toast}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">Cookies & Data</h2>
          <p className="text-xs text-fg/40 mt-0.5">
            {cookies.length} cookies across {domains.length} domains
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={deleteAllCookies} className="text-xs py-1.5 px-3 rounded text-destructive hover:bg-destructive/10 transition-colors">
            Delete All Cookies
          </button>
        </div>
      </div>

      {/* Clearing actions */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <button
          onClick={clearCache}
          disabled={clearing !== null}
          className="p-4 rounded-lg bg-card border border-border hover:border-chart-1/40 transition-colors text-center group">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-fg/40 group-hover:text-chart-1 transition-colors">
            <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.66 0 3-4.03 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4.03-3-9s1.34-9 3-9m-9 9a9 9 0 0 1 9-9" />
          </svg>
          <span className="text-sm font-medium">{clearing === "cache" ? "Clearing..." : "Clear Cache"}</span>
        </button>

        <button
          onClick={clearHistory}
          disabled={clearing !== null}
          className="p-4 rounded-lg bg-card border border-border hover:border-chart-5/40 transition-colors text-center group">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-fg/40 group-hover:text-chart-5 transition-colors">
            <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
          </svg>
          <span className="text-sm font-medium">{clearing === "history" ? "Clearing..." : "Clear History"}</span>
        </button>

        <button
          onClick={clearAll}
          disabled={clearing !== null}
          className="p-4 rounded-lg bg-card border border-destructive/30 hover:border-destructive/60 transition-colors text-center group">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mx-auto mb-2 text-fg/40 group-hover:text-destructive transition-colors">
            <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
          <span className="text-sm font-medium text-destructive/80">{clearing === "all" ? "Clearing..." : "Clear Everything"}</span>
          <p className="text-[10px] text-fg/20 mt-0.5">Cache + history + cookies + storage</p>
        </button>
      </div>

      {/* Search + domain filter */}
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search cookies by name, domain, or value..."
        className="w-full text-sm py-2 px-3 rounded bg-card border border-border text-fg placeholder-fg/30 outline-none focus:border-primary/50 transition-colors mb-3"
      />

      {/* Domain pills */}
      <div className="flex gap-1 mb-4 flex-wrap max-h-20 overflow-y-auto">
        <button
          onClick={() => setSelectedDomain(null)}
          className={`text-[11px] py-0.5 px-2 rounded transition-colors ${
            !selectedDomain ? "bg-chart-1/20 text-chart-1" : "bg-accent/50 text-fg/40 hover:text-fg/60"
          }`}>
          All ({cookies.length})
        </button>
        {domains.map((d) => {
          const count = cookies.filter((c) => c.domain === d).length
          return (
            <button
              key={d}
              onClick={() => setSelectedDomain(selectedDomain === d ? null : d)}
              className={`text-[11px] py-0.5 px-2 rounded transition-colors ${
                selectedDomain === d ? "bg-chart-1/20 text-chart-1" : "bg-accent/50 text-fg/40 hover:text-fg/60"
              }`}>
              {d} ({count})
            </button>
          )
        })}
      </div>

      {/* Domain header with bulk delete */}
      {selectedDomain && (
        <div className="flex items-center justify-between mb-3 p-2 rounded bg-card/50 border border-border">
          <span className="text-sm font-medium">{selectedDomain}</span>
          <button
            onClick={() => deleteAllForDomain(selectedDomain)}
            className="text-xs py-1 px-3 rounded text-destructive hover:bg-destructive/10 transition-colors">
            Delete all for this domain
          </button>
        </div>
      )}

      {/* Cookie list */}
      {loading ? (
        <div className="text-fg/40 text-sm">Loading cookies...</div>
      ) : (
        <div className="grid gap-1">
          {filtered.map((cookie, i) => (
            <div
              key={`${cookie.domain}-${cookie.name}-${cookie.path}-${i}`}
              className="flex items-start gap-3 p-3 rounded-lg hover:bg-card/50 transition-colors group">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-fg truncate">{cookie.name}</span>
                  <span className="text-[10px] text-fg/20">{cookie.domain}</span>
                </div>
                <p className="text-[11px] text-fg/30 truncate mt-0.5 font-mono max-w-[500px]">{cookie.value || "(empty)"}</p>
                <div className="flex items-center gap-2 mt-1">
                  {cookie.secure && <span className="text-[9px] px-1.5 py-0.5 rounded bg-chart-2/15 text-chart-2">Secure</span>}
                  {cookie.httpOnly && <span className="text-[9px] px-1.5 py-0.5 rounded bg-chart-5/15 text-chart-5">HttpOnly</span>}
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-accent text-fg/40">{cookie.sameSite}</span>
                  {cookie.expirationDate && (
                    <span className="text-[9px] text-fg/20">
                      Expires {new Date(cookie.expirationDate * 1000).toLocaleDateString()}
                    </span>
                  )}
                  {!cookie.expirationDate && <span className="text-[9px] text-fg/20">Session</span>}
                </div>
              </div>
              <button
                onClick={() => deleteCookie(cookie)}
                title="Delete cookie"
                className="p-1.5 rounded text-fg/20 opacity-0 group-hover:opacity-100 hover:text-destructive transition-all flex-shrink-0">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
              </button>
            </div>
          ))}
          {filtered.length === 0 && !loading && (
            <p className="text-sm text-fg/30">
              {cookies.length === 0 ? "No cookies found." : "No cookies match your search."}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
