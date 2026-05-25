import { useEffect, useMemo, useState } from "react"
import { LeoBadge, LeoButton, LeoIcon } from "../../components/leo"
import { openExternalLink } from "../../lib/open-url"

interface SocialLink {
  label: string
  url: string
}

interface QuickInfoData {
  url: string
  title: string
  description: string
  siteName: string
  author: string
  canonicalUrl: string
  h1: string
  emails: string[]
  phones: string[]
  socialLinks: SocialLink[]
  organizations: string[]
  locations: string[]
}

interface LoadState {
  data: QuickInfoData | null
  error: string | null
  loading: boolean
}

const SOCIAL_HOST_LABELS: Array<[string, string]> = [
  ["linkedin.com", "LinkedIn"],
  ["github.com", "GitHub"],
  ["x.com", "X"],
  ["twitter.com", "X"],
  ["facebook.com", "Facebook"],
  ["instagram.com", "Instagram"],
  ["youtube.com", "YouTube"],
  ["mastodon", "Mastodon"],
  ["bsky.app", "Bluesky"]
]

const RESTRICTED_URL_RE = /^(chrome|chrome-extension|brave|edge|about):/i

function unique(values: string[], limit = 12): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim()
    if (!normalized) continue
    const key = normalized.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(normalized)
    if (out.length >= limit) break
  }
  return out
}

function hostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "")
  } catch {
    return value
  }
}

function socialLabel(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return SOCIAL_HOST_LABELS.find(([needle]) => host.includes(needle))?.[1] ?? null
  } catch {
    return null
  }
}

function summarize(data: QuickInfoData | null) {
  if (!data) return []
  return [
    data.siteName || hostname(data.url),
    data.h1 || data.title,
    ...data.organizations,
    ...data.locations
  ].filter(Boolean)
}

function extractQuickInfoFromPage(): QuickInfoData {
  const readMeta = (...names: string[]) => {
    for (const name of names) {
      const node = document.querySelector<HTMLMetaElement>(
        `meta[name="${name}"], meta[property="${name}"]`
      )
      const value = node?.content?.trim()
      if (value) return value
    }
    return ""
  }

  const uniqueValues = (values: string[], limit = 12) => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const value of values) {
      const normalized = value.replace(/\s+/g, " ").trim()
      if (!normalized) continue
      const key = normalized.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(normalized)
      if (out.length >= limit) break
    }
    return out
  }

  const socialLabels: Array<[string, string]> = [
    ["linkedin.com", "LinkedIn"],
    ["github.com", "GitHub"],
    ["x.com", "X"],
    ["twitter.com", "X"],
    ["facebook.com", "Facebook"],
    ["instagram.com", "Instagram"],
    ["youtube.com", "YouTube"],
    ["mastodon", "Mastodon"],
    ["bsky.app", "Bluesky"]
  ]

  const text = document.body?.innerText?.slice(0, 30000) ?? ""
  const links = Array.from(document.links)
  const mailtoEmails = links
    .map((link) => link.href.match(/^mailto:([^?]+)/i)?.[1] ?? "")
    .filter(Boolean)
  const textEmails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []
  const phoneMatches =
    text.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g) ?? []
  const socialLinks = links
    .map((link) => {
      let label = ""
      try {
        const host = new URL(link.href).hostname.toLowerCase()
        label = socialLabels.find(([needle]) => host.includes(needle))?.[1] ?? ""
      } catch {
        label = ""
      }
      return label ? { label, url: link.href } : null
    })
    .filter((link): link is SocialLink => Boolean(link))

  const organizations = uniqueValues([
    readMeta("og:site_name", "application-name"),
    ...Array.from(document.querySelectorAll<HTMLElement>('[itemprop="name"], [property="name"]'))
      .map((node) => node.innerText || node.textContent || "")
  ], 8)

  const locations = uniqueValues([
    readMeta("business:contact_data:locality"),
    readMeta("business:contact_data:region"),
    ...Array.from(document.querySelectorAll<HTMLElement>(
      "address, [itemprop='address'], [class*='address' i], [class*='location' i]"
    )).map((node) => node.innerText || node.textContent || "")
  ], 8)

  return {
    url: location.href,
    title: document.title || "",
    description: readMeta("description", "og:description", "twitter:description"),
    siteName: readMeta("og:site_name", "application-name"),
    author: readMeta("author", "article:author"),
    canonicalUrl: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? "",
    h1: document.querySelector("h1")?.textContent?.trim() ?? "",
    emails: uniqueValues([...mailtoEmails, ...textEmails], 12),
    phones: uniqueValues(phoneMatches, 12),
    socialLinks: uniqueValues(socialLinks.map((link) => `${link.label}\t${link.url}`), 12).map(
      (value) => {
        const [label, url] = value.split("\t")
        return { label, url }
      }
    ),
    organizations,
    locations
  }
}

export function QuickInfoSection() {
  const [state, setState] = useState<LoadState>({
    data: null,
    error: null,
    loading: true
  })

  const keyFacts = useMemo(() => summarize(state.data).slice(0, 5), [state.data])

  async function load() {
    setState((current) => ({ ...current, error: null, loading: true }))
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id || !tab.url) throw new Error("No active page")
      if (RESTRICTED_URL_RE.test(tab.url)) {
        throw new Error("This page cannot be inspected from the sidebar.")
      }
      const [result] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: extractQuickInfoFromPage
      })
      setState({
        data: result.result ?? null,
        error: null,
        loading: false
      })
    } catch (err) {
      setState({
        data: null,
        error: err instanceof Error ? err.message : String(err),
        loading: false
      })
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const data = state.data

  return (
    <section className="flex h-full min-w-0 flex-col overflow-hidden" data-testid="quick-info-section">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-fg">Contact Enrichment</h1>
          <p className="truncate text-[11px] text-fg/45">
            {data ? hostname(data.url) : "Current page"}
          </p>
        </div>
        <LeoButton size="xs" variant="neutral" onClick={() => void load()} disabled={state.loading}>
          {state.loading ? "Refreshing" : "Refresh"}
        </LeoButton>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {state.error && (
          <div className="rounded border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            {state.error}
          </div>
        )}

        {!state.error && state.loading && (
          <div className="rounded border border-border bg-card/25 p-3 text-xs text-fg/45">
            Reading active page...
          </div>
        )}

        {data && (
          <div className="grid gap-3">
            <section className="rounded border border-border bg-card/25 p-3">
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold text-fg">
                    {data.siteName || data.h1 || data.title || hostname(data.url)}
                  </h2>
                  <a
                    href={data.url}
                    onClick={openExternalLink(data.url)}
                    className="block truncate text-[11px] text-primary/80 hover:text-primary"
                    title={data.url}
                  >
                    {hostname(data.url)}
                  </a>
                </div>
                <LeoBadge variant={data.emails.length || data.phones.length ? "success" : "neutral"}>
                  {data.emails.length || data.phones.length ? "Contact" : "Website"}
                </LeoBadge>
              </div>
              {data.description && (
                <p className="line-clamp-4 text-xs leading-5 text-fg/65">{data.description}</p>
              )}
              {keyFacts.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {keyFacts.map((fact) => (
                    <LeoBadge key={fact} title={fact}>
                      <span className="max-w-[180px] truncate">{fact}</span>
                    </LeoBadge>
                  ))}
                </div>
              )}
            </section>

            <InfoList title="Emails" items={data.emails} kind="email" />
            <InfoList title="Phones" items={data.phones} kind="phone" />
            <InfoList title="Organizations" items={data.organizations} />
            <InfoList title="Locations" items={data.locations} />

            <section className="rounded border border-border bg-card/25 p-3">
              <SectionTitle title="Social Links" count={data.socialLinks.length} />
              {data.socialLinks.length === 0 ? (
                <EmptyLine />
              ) : (
                <div className="grid gap-1.5">
                  {data.socialLinks.map((link) => (
                    <a
                      key={`${link.label}:${link.url}`}
                      href={link.url}
                      onClick={openExternalLink(link.url)}
                      className="flex min-w-0 items-center gap-2 rounded border border-border/60 bg-bg/60 px-2 py-1.5 text-xs hover:bg-accent"
                      title={link.url}
                    >
                      <LeoIcon name="globe" size={13} className="shrink-0 text-fg/35" />
                      <span className="shrink-0 font-medium text-fg/70">{link.label}</span>
                      <span className="min-w-0 flex-1 truncate text-fg/45">{hostname(link.url)}</span>
                    </a>
                  ))}
                </div>
              )}
            </section>

            {(data.author || data.canonicalUrl) && (
              <section className="rounded border border-border bg-card/25 p-3">
                <SectionTitle title="Source" />
                <div className="grid gap-1.5 text-xs text-fg/65">
                  {data.author && <div className="break-words">Author: {data.author}</div>}
                  {data.canonicalUrl && (
                    <a
                      href={data.canonicalUrl}
                      onClick={openExternalLink(data.canonicalUrl)}
                      className="truncate text-primary/80 hover:text-primary"
                      title={data.canonicalUrl}
                    >
                      {data.canonicalUrl}
                    </a>
                  )}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

function SectionTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wide text-fg/50">{title}</h2>
      {count !== undefined && <span className="text-[10px] text-fg/35">{count}</span>}
    </div>
  )
}

function EmptyLine() {
  return <div className="text-xs text-fg/35">None found</div>
}

function InfoList({
  title,
  items,
  kind
}: {
  title: string
  items: string[]
  kind?: "email" | "phone"
}) {
  return (
    <section className="rounded border border-border bg-card/25 p-3">
      <SectionTitle title={title} count={items.length} />
      {items.length === 0 ? (
        <EmptyLine />
      ) : (
        <div className="grid gap-1.5">
          {items.map((item) => {
            const href =
              kind === "email"
                ? `mailto:${item}`
                : kind === "phone"
                  ? `tel:${item.replace(/[^\d+]/g, "")}`
                  : null
            const content = (
              <span className="min-w-0 flex-1 truncate text-fg/70" title={item}>
                {item}
              </span>
            )
            return href ? (
              <a
                key={item}
                href={href}
                className="flex min-w-0 rounded border border-border/60 bg-bg/60 px-2 py-1.5 text-xs hover:bg-accent"
              >
                {content}
              </a>
            ) : (
              <div
                key={item}
                className="flex min-w-0 rounded border border-border/60 bg-bg/60 px-2 py-1.5 text-xs"
              >
                {content}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
