import { useState, useEffect } from "react"
import { LeoIcon, LeoIconButton } from "../../../components/leo"

interface TechInfo {
  name: string
  category: string
  version?: string
  confidence: string
}

interface IpInfo {
  ip: string
  city?: string
  region?: string
  country?: string
  org?: string
}

interface SiteIpInfo {
  ip: string
  hostname: string
  city?: string
  region?: string
  country?: string
  org?: string
}

export interface FeedInfo {
  url: string
  title: string
  type: "rss" | "atom" | "json"
}

type Panel = "network" | "tech" | "rss" | null

export function useInfoPanels() {
  const [techs, setTechs] = useState<TechInfo[]>([])
  const [userIp, setUserIp] = useState<IpInfo | null>(null)
  const [siteIp, setSiteIp] = useState<SiteIpInfo | null>(null)
  const [feeds, setFeeds] = useState<FeedInfo[]>([])
  const [activePanel, setActivePanel] = useState<Panel>(null)

  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (!tab?.id) return

      // Tech detection
      chrome.tabs.sendMessage(tab.id, { type: "GET_TECH" }, (response) => {
        if (chrome.runtime.lastError) return
        if (response?.techs) setTechs(response.techs)
      })

      // RSS feed detection
      chrome.tabs.sendMessage(tab.id, { type: "GET_FEEDS" }, (response) => {
        if (chrome.runtime.lastError) return
        if (response?.feeds) setFeeds(response.feeds)
      })

      // Site IP + geo
      if (tab.url) {
        try {
          const hostname = new URL(tab.url).hostname
          if (hostname) {
            chrome.runtime.sendMessage({ type: "RESOLVE_IP", hostname }, (response) => {
              if (chrome.runtime.lastError || !response?.ip) return
              const ip = response.ip
              setSiteIp({ ip, hostname })
              // Fetch geo info for the site IP
              fetch(`https://ipinfo.io/${ip}/json?token=`)
                .then((r) => r.json())
                .then((data) => {
                  setSiteIp({ ip, hostname, city: data.city, region: data.region, country: data.country, org: data.org })
                })
                .catch(() => {})
            })
          }
        } catch {}
      }
    })

    // User IP
    fetch("https://ipinfo.io/json?token=")
      .then((r) => r.json())
      .then((data) => setUserIp(data))
      .catch(() => {
        fetch("https://api.ipify.org?format=json")
          .then((r) => r.json())
          .then((data) => setUserIp({ ip: data.ip }))
          .catch(() => {})
      })
  }, [])

  const toggle = (panel: Panel) => {
    setActivePanel((cur) => (cur === panel ? null : panel))
  }

  return { techs, userIp, siteIp, feeds, activePanel, toggle }
}

// --- Icon Buttons ---

export function NetworkButton({ active, hasData, onClick }: { active: boolean; hasData: boolean; onClick: () => void }) {
  return (
    <LeoIconButton
      active={active}
      aria-label="Network info"
      className={active ? "relative text-chart-3" : "relative text-fg/60 hover:text-fg"}
      icon="globe"
      iconSize={14}
      onClick={onClick}
      title="Network info"
      variant="ghost"
    />
  )
}

export function TechButton({ active, count, onClick }: { active: boolean; count: number; onClick: () => void }) {
  return (
    <LeoIconButton
      active={active}
      aria-label="Detect technologies"
      className={`relative ${active ? "text-chart-5" : count > 0 ? "text-chart-5/60 hover:text-chart-5" : "text-fg/60 hover:text-fg"}`}
      icon="browser-extensions"
      iconSize={14}
      onClick={onClick}
      title="Detect technologies"
      variant="ghost">
      {count > 0 && !active && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-chart-5" />}
    </LeoIconButton>
  )
}

export function RssButton({ active, count, onClick }: { active: boolean; count: number; onClick: () => void }) {
  return (
    <LeoIconButton
      active={active}
      aria-label="RSS feeds"
      className={`relative ${active ? "text-orange-400" : count > 0 ? "text-orange-400/60 hover:text-orange-400" : "text-fg/60 hover:text-fg"}`}
      icon="rss"
      iconSize={14}
      onClick={onClick}
      title="RSS feeds"
      variant="ghost">
      {count > 0 && !active && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-orange-400" />}
    </LeoIconButton>
  )
}

// --- Panels ---

export function NetworkPanel({ userIp, siteIp, onCopy }: { userIp: IpInfo | null; siteIp: SiteIpInfo | null; onCopy: (text: string, label: string) => void }) {
  return (
    <div className="border-b border-border px-3 py-2.5 space-y-2">
      <p className="text-[10px] text-fg/30 uppercase tracking-wider">Network</p>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-fg/40">Your IP</span>
        {userIp ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-fg font-mono">{userIp.ip}</span>
            <CopyBtn onClick={() => onCopy(userIp.ip, "IP copied")} />
          </div>
        ) : (
          <span className="text-[11px] text-fg/20">loading...</span>
        )}
      </div>
      {userIp?.city && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-fg/40">Location</span>
          <span className="text-xs text-fg/60">{[userIp.city, userIp.region, userIp.country].filter(Boolean).join(", ")}</span>
        </div>
      )}
      {userIp?.org && (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-fg/40">ISP</span>
          <span className="text-xs text-fg/60 truncate max-w-[200px]">{userIp.org}</span>
        </div>
      )}
      {siteIp && (
        <>
          <div className="border-t border-border/50 my-1" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-fg/40">Site IP</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg font-mono">{siteIp.ip}</span>
              <CopyBtn onClick={() => onCopy(siteIp.ip, "Site IP copied")} />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-fg/40">Host</span>
            <span className="text-xs text-fg/60 font-mono">{siteIp.hostname}</span>
          </div>
          {siteIp.city && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-fg/40">Site Location</span>
              <span className="text-xs text-fg/60">{[siteIp.city, siteIp.region, siteIp.country].filter(Boolean).join(", ")}</span>
            </div>
          )}
          {siteIp.org && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-fg/40">Site ISP</span>
              <span className="text-xs text-fg/60 truncate max-w-[200px]">{siteIp.org}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function confidenceClass(confidence: string) {
  switch (confidence.toLowerCase()) {
    case "high":
      return "bg-red-500/15 text-red-400"
    case "medium":
      return "bg-warning/15 text-warning"
    default:
      return "bg-accent text-fg/40"
  }
}

export function TechPanel({ techs }: { techs: TechInfo[] }) {
  return (
    <div className="border-b border-border">
      {techs.length > 0 ? (
        <div className="px-3 py-2 space-y-1 max-h-[160px] overflow-y-auto">
          <p className="text-[10px] text-fg/30 uppercase tracking-wider mb-1">Detected Technologies</p>
          {techs.map((t, i) => (
            <div key={i} className="flex items-center justify-between py-0.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-fg">{t.name}</span>
                {t.version && <span className="text-[10px] text-fg/30">v{t.version}</span>}
              </div>
              <div className="flex flex-shrink-0 items-center gap-1">
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent text-fg/40">{t.category}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded uppercase font-medium ${confidenceClass(t.confidence)}`}>
                  {t.confidence}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-fg/30 text-center">No technologies detected on this page</div>
      )}
    </div>
  )
}

export function RssPanel({
  feeds,
  allFeeds,
  onCopy,
  onSaveFeed
}: {
  feeds: FeedInfo[]
  allFeeds?: FeedInfo[]
  onCopy: (text: string, label: string) => void
  onSaveFeed?: (feed: FeedInfo) => void | Promise<void>
}) {
  const saveAllFeeds = allFeeds ?? feeds
  return (
    <div className="border-b border-border">
      {feeds.length > 0 ? (
        <div className="px-3 py-2 space-y-1.5 max-h-[160px] overflow-y-auto">
          <p className="text-[10px] text-fg/30 uppercase tracking-wider mb-1">RSS / Atom Feeds</p>
          {feeds.map((f, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5 group">
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 uppercase font-medium flex-shrink-0">{f.type}</span>
              <span className="text-xs text-fg truncate flex-1" title={f.title}>{f.title || f.url}</span>
              {onSaveFeed && (
                <button
                  onClick={() => onSaveFeed(f)}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-chart-1/15 text-chart-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 hover:bg-chart-1/25">
                  Save
                </button>
              )}
              <CopyBtn onClick={() => onCopy(f.url, "Feed URL copied")} />
            </div>
          ))}
          {onSaveFeed && saveAllFeeds.length > 1 && (
            <button
              onClick={() => void saveFeeds(saveAllFeeds, onSaveFeed)}
              className="w-full text-[10px] py-1 mt-1 rounded bg-chart-1/10 text-chart-1 hover:bg-chart-1/20 transition-colors">
              Save all {saveAllFeeds.length} feeds
            </button>
          )}
        </div>
      ) : (
        <div className="px-3 py-3 text-xs text-fg/30 text-center">No RSS/Atom feeds found on this page</div>
      )}
    </div>
  )
}

async function saveFeeds(
  feeds: FeedInfo[],
  onSaveFeed: (feed: FeedInfo) => void | Promise<void>
) {
  for (const feed of feeds) {
    await onSaveFeed(feed)
  }
}

function CopyBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-fg/20 hover:text-fg/50 transition-colors flex-shrink-0">
      <LeoIcon name="link-normal" size={10} />
    </button>
  )
}
