import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle"
}

interface TechDetection {
  name: string
  category: string
  version?: string
  confidence: "high" | "medium" | "low"
}

const SIGNAL_TEXT_LIMIT = 250_000

function hostMatches(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase()
  const target = domain.toLowerCase()
  return host === target || host.endsWith(`.${target}`)
}

function detectTechnologies(): TechDetection[] {
  const techs: TechDetection[] = []
  const w = window as any
  const html = document.documentElement.outerHTML.slice(0, SIGNAL_TEXT_LIMIT).toLowerCase()
  const assetUrls = collectAssetUrls()
  const srcs = assetUrls
    .map((url) => `${url.hostname} ${url.pathname} ${url.search}`)
    .join(" ")
    .toLowerCase()
  const inlineSignals = Array.from(document.querySelectorAll("script:not([src]), style"))
    .map((el) => el.textContent || "")
    .join(" ")
    .slice(0, SIGNAL_TEXT_LIMIT)
    .toLowerCase()
  const metaSignals = Array.from(document.querySelectorAll("meta"))
    .map((el) => `${el.getAttribute("name") || ""} ${el.getAttribute("property") || ""} ${el.getAttribute("content") || ""}`)
    .join(" ")
    .toLowerCase()
  const signals = `${srcs} ${html} ${inlineSignals} ${metaSignals}`
  const hasSignal = (...needles: string[]) =>
    needles.some((needle) => signals.includes(needle.toLowerCase()))
  const hasAssetHost = (...domains: string[]) =>
    assetUrls.some((url) => domains.some((domain) => hostMatches(url.hostname, domain)))
  const hasAssetPath = (...needles: string[]) =>
    assetUrls.some((url) => needles.some((needle) => url.pathname.toLowerCase().includes(needle)))
  const hasSelector = (selector: string) => Boolean(safeQuery(selector))

  // Frameworks
  if (w.__NEXT_DATA__ || hasSelector("#__next") || hasAssetPath("/_next/") || hasSignal("__next_data__")) {
    techs.push({ name: "Next.js", category: "Framework", confidence: "high" })
  }
  if (w.__NUXT__ || w.__nuxt__ || hasSelector("#__nuxt") || hasAssetPath("/_nuxt/") || hasSignal("data-nuxt")) {
    techs.push({ name: "Nuxt.js", category: "Framework", confidence: "high" })
  }
  if (w.Remix || hasSelector('[data-remix-run]') || hasSignal("__remixcontext", "@remix-run", "remix-run")) {
    techs.push({ name: "Remix", category: "Framework", confidence: "high" })
  }
  if (w.__GATSBY || hasSelector("#___gatsby") || hasSignal("gatsby-focus-wrapper", "gatsby-script-loader")) {
    techs.push({ name: "Gatsby", category: "Framework", confidence: "high" })
  }
  if (w.Astro || hasSelector('[data-astro-cid]') || hasSelector('astro-island') || hasAssetPath("/_astro/")) {
    techs.push({ name: "Astro", category: "Framework", confidence: "high" })
  }
  if (hasSelector('[data-sveltekit]') || hasSelector('[data-svelte]') || hasAssetPath("/_app/immutable/") || hasSignal("sveltekit")) {
    techs.push({ name: "SvelteKit", category: "Framework", confidence: "high" })
  }
  if (hasSignal("/@vite/client", "vite/modulepreload", "vite.svg") || hasSelector('script[type="module"][src*="/src/"]')) {
    techs.push({ name: "Vite", category: "Build Tool", confidence: "medium" })
  }

  // UI Libraries
  if (
    w.React ||
    w.__REACT_DEVTOOLS_GLOBAL_HOOK__ ||
    hasSelector("[data-reactroot]") ||
    hasSelector("[data-reactid]") ||
    hasSignal("react-dom", "react-refresh", "data-react-helmet", "__next_data__")
  ) {
    techs.push({ name: "React", category: "UI Library", confidence: "high" })
  }
  if (w.Vue || hasSelector("[v-cloak]") || hasSignal("vue.runtime", "vue.global", "__vue__", "data-v-")) {
    techs.push({ name: "Vue.js", category: "UI Library", confidence: "high" })
  }
  if (w.angular || hasSelector("[ng-version]") || hasSignal("ng-version", "_nghost-", "ngsw.json", "angular")) {
    const ver = safeQuery("[ng-version]")?.getAttribute("ng-version")
    techs.push({ name: "Angular", category: "UI Library", version: ver || undefined, confidence: "high" })
  }
  if (w.Svelte || hasSignal("svelte-", "svelte/internal")) {
    techs.push({ name: "Svelte", category: "UI Library", confidence: "medium" })
  }
  if (w.htmx || hasAssetPath("htmx") || hasSelector("[hx-get], [hx-post], [hx-trigger], [data-hx-get], [data-hx-post]")) {
    techs.push({ name: "htmx", category: "UI Library", confidence: "high" })
  }
  if (w.Alpine || hasAssetPath("alpine") || hasSelector("[x-data], [x-init], [x-show], [x-bind]")) {
    techs.push({ name: "Alpine.js", category: "UI Library", confidence: "high" })
  }
  if (hasSelector("[data-hk]") || hasSignal("solid-js", "solidjs")) {
    techs.push({ name: "Solid", category: "UI Library", confidence: "medium" })
  }
  if (hasSelector("q\\:container") || hasSignal("q:container", "qwik/json", "@builder.io/qwik")) {
    techs.push({ name: "Qwik", category: "UI Library", confidence: "high" })
  }
  if (hasSignal("lit-html", "lit-element", "@lit/reactive-element")) {
    techs.push({ name: "Lit", category: "UI Library", confidence: "medium" })
  }

  // CSS
  if (hasSelector('link[href*="tailwind"]') || html.includes("tailwindcss") || checkTailwindClasses()) {
    techs.push({ name: "Tailwind CSS", category: "CSS", confidence: "medium" })
  }
  if (hasSelector('link[href*="bootstrap"]') || hasAssetPath("bootstrap") || w.bootstrap) {
    techs.push({ name: "Bootstrap", category: "CSS", confidence: "high" })
  }
  if (hasSelector('[class*="chakra-"]')) {
    techs.push({ name: "Chakra UI", category: "CSS", confidence: "high" })
  }
  if (hasSelector('[class*="MuiBox"]') || hasSelector('[class*="css-"][class*="MuiButton"]') || hasSignal("@mui/", "mui-")) {
    techs.push({ name: "Material UI", category: "CSS", confidence: "high" })
  }
  if (hasSelector('[class*="ant-"]')) {
    techs.push({ name: "Ant Design", category: "CSS", confidence: "high" })
  }
  if (hasSelector('[class*="mantine-"]')) {
    techs.push({ name: "Mantine", category: "CSS", confidence: "high" })
  }
  if (hasSelector('[class*="radix-"]') || hasSelector('[data-radix-collection-item]')) {
    techs.push({ name: "Radix UI", category: "CSS", confidence: "high" })
  }
  if (srcs.includes("styled-components") || hasSelector('style[data-styled]')) {
    techs.push({ name: "styled-components", category: "CSS", confidence: "high" })
  }
  if (hasSelector('[class*="emotion-"]') || hasSelector('style[data-emotion]')) {
    techs.push({ name: "Emotion", category: "CSS", confidence: "high" })
  }
  if (hasSelector('link[href*="bulma"]') || hasSelector(".bulma")) {
    techs.push({ name: "Bulma", category: "CSS", confidence: "high" })
  }
  if (hasSelector('[class*="foundation-"]') || w.Foundation) {
    techs.push({ name: "Foundation", category: "CSS", confidence: "high" })
  }

  // State Management
  if (w.__REDUX_DEVTOOLS_EXTENSION__ || w.__REDUX_STORE__) {
    techs.push({ name: "Redux", category: "State", confidence: "medium" })
  }
  if (w.__MOBX_DEVTOOLS_GLOBAL_HOOK__ || w.mobx) {
    techs.push({ name: "MobX", category: "State", confidence: "medium" })
  }
  if (hasSelector("[data-rk]") || w.zustand) {
    techs.push({ name: "Zustand", category: "State", confidence: "low" })
  }

  // Analytics & Services
  if (w.gtag || w.ga || w.google_tag_manager || hasAssetHost("google-analytics.com")) {
    techs.push({ name: "Google Analytics", category: "Analytics", confidence: "high" })
  }
  if (w.google_tag_manager || hasAssetHost("googletagmanager.com")) {
    techs.push({ name: "Google Tag Manager", category: "Analytics", confidence: "high" })
  }
  if (w.mixpanel || hasAssetHost("mixpanel.com")) {
    techs.push({ name: "Mixpanel", category: "Analytics", confidence: "high" })
  }
  if (w.Sentry || hasAssetHost("sentry.io", "sentry-cdn.com") || hasSignal("__sentry")) {
    techs.push({ name: "Sentry", category: "Monitoring", confidence: "high" })
  }
  if (w.amplitude || hasAssetHost("amplitude.com")) {
    techs.push({ name: "Amplitude", category: "Analytics", confidence: "high" })
  }
  if (w.Intercom || hasAssetHost("intercom.io", "intercomcdn.com")) {
    techs.push({ name: "Intercom", category: "Support", confidence: "high" })
  }
  if (w.drift || hasAssetHost("drift.com", "driftt.com")) {
    techs.push({ name: "Drift", category: "Support", confidence: "high" })
  }
  if (w.Crisp || hasAssetHost("crisp.chat", "crisp.help")) {
    techs.push({ name: "Crisp", category: "Support", confidence: "high" })
  }
  if (w.zE || hasSelector("#ze-snippet") || hasAssetHost("zendesk.com", "zdassets.com")) {
    techs.push({ name: "Zendesk", category: "Support", confidence: "high" })
  }
  if (w.HubSpotConversations || hasAssetHost("hubspot.com", "hs-scripts.com", "hsforms.net")) {
    techs.push({ name: "HubSpot", category: "Marketing", confidence: "high" })
  }
  if (w.hj || hasAssetHost("hotjar.com")) {
    techs.push({ name: "Hotjar", category: "Analytics", confidence: "high" })
  }
  if (w.Segment || w.analytics?.identify || hasAssetHost("segment.com", "segment.io")) {
    techs.push({ name: "Segment", category: "Analytics", confidence: "medium" })
  }
  if (w.posthog || hasAssetHost("posthog.com")) {
    techs.push({ name: "PostHog", category: "Analytics", confidence: "high" })
  }
  if (w.plausible || hasAssetHost("plausible.io")) {
    techs.push({ name: "Plausible", category: "Analytics", confidence: "high" })
  }
  if (hasAssetPath("cloudflareinsights") || w.__cfBeacon) {
    techs.push({ name: "Cloudflare Web Analytics", category: "Analytics", confidence: "high" })
  }
  if (hasSelector('[data-nextjs-scroll-focus-boundary]')) {
    techs.push({ name: "Next.js App Router", category: "Framework", confidence: "high" })
  }

  // Hosting / CDN / CMS
  if (hasSignal("wordpress") || hasAssetPath("wp-content", "wp-includes") || w.wp) {
    techs.push({ name: "WordPress", category: "CMS", confidence: "high" })
  }
  if (hasSignal("drupal") || hasAssetPath("/sites/default/")) {
    techs.push({ name: "Drupal", category: "CMS", confidence: "high" })
  }
  if (hasSignal("joomla")) {
    techs.push({ name: "Joomla", category: "CMS", confidence: "high" })
  }
  if (hasSignal("ghost") || hasAssetPath("/ghost/") || w.ghost) {
    techs.push({ name: "Ghost", category: "CMS", confidence: "high" })
  }
  if (hasSignal("hugo")) {
    techs.push({ name: "Hugo", category: "SSG", confidence: "high" })
  }
  if (hasSignal("jekyll")) {
    techs.push({ name: "Jekyll", category: "SSG", confidence: "high" })
  }
  if (hasSignal("shopify") || hasAssetHost("myshopify.com", "shopifycdn.net") || w.Shopify) {
    techs.push({ name: "Shopify", category: "Platform", confidence: "high" })
  }
  if (hasSignal("webflow") || hasAssetHost("webflow.com", "website-files.com")) {
    techs.push({ name: "Webflow", category: "Platform", confidence: "high" })
  }
  if (hasSignal("squarespace") || hasAssetHost("squarespace.com", "sqspcdn.com")) {
    techs.push({ name: "Squarespace", category: "Platform", confidence: "high" })
  }
  if (hasSignal("wix") || hasAssetHost("wixstatic.com", "wix.com") || w.wixBiSession) {
    techs.push({ name: "Wix", category: "Platform", confidence: "high" })
  }
  if (hasSignal("framer") || hasAssetHost("framerusercontent.com") || w.__framer) {
    techs.push({ name: "Framer", category: "Platform", confidence: "high" })
  }
  if (w.Notion || hasSignal("notion")) {
    techs.push({ name: "Notion", category: "Platform", confidence: "high" })
  }

  // CDN / Hosting
  if (srcs.includes("cloudflare") || hasAssetHost("cdnjs.cloudflare.com", "cloudflareinsights.com")) {
    techs.push({ name: "Cloudflare CDN", category: "CDN", confidence: "medium" })
  }
  if (hasAssetHost("unpkg.com")) {
    techs.push({ name: "unpkg", category: "CDN", confidence: "high" })
  }
  if (hasAssetHost("jsdelivr.net")) {
    techs.push({ name: "jsDelivr", category: "CDN", confidence: "high" })
  }
  if (srcs.includes("vercel") || hasSelector('meta[name="x-vercel-id"]')) {
    techs.push({ name: "Vercel", category: "Hosting", confidence: "high" })
  }
  if (srcs.includes("netlify") || hasSignal("netlify")) {
    techs.push({ name: "Netlify", category: "Hosting", confidence: "high" })
  }
  if (hasSelector('meta[name="firebase-app"]') || srcs.includes("firebase") || hasAssetHost("firebaseapp.com", "firebaseio.com")) {
    techs.push({ name: "Firebase", category: "Backend", confidence: "medium" })
  }
  if (srcs.includes("supabase")) {
    techs.push({ name: "Supabase", category: "Backend", confidence: "medium" })
  }
  if (srcs.includes("aws") || srcs.includes("amazonaws")) {
    techs.push({ name: "AWS", category: "Cloud", confidence: "medium" })
  }

  // JavaScript Libraries
  if (w.jQuery || w.$?.fn?.jquery || hasAssetPath("jquery")) {
    const ver = w.jQuery?.fn?.jquery || w.$?.fn?.jquery
    techs.push({ name: "jQuery", category: "Library", version: ver, confidence: "high" })
  }
  if (w.gsap || w.TweenMax || hasAssetPath("gsap")) {
    techs.push({ name: "GSAP", category: "Animation", confidence: "high" })
  }
  if (w.THREE || hasAssetPath("three")) {
    techs.push({ name: "Three.js", category: "3D", confidence: "high" })
  }
  if (w.d3 || hasAssetPath("d3.")) {
    techs.push({ name: "D3.js", category: "Visualization", confidence: "high" })
  }
  if (w.Chart || hasAssetPath("chart.js", "chart.min.js")) {
    techs.push({ name: "Chart.js", category: "Visualization", confidence: "high" })
  }
  if (w.Highcharts || hasAssetPath("highcharts")) {
    techs.push({ name: "Highcharts", category: "Visualization", confidence: "high" })
  }
  if (w.Lodash || w._?.VERSION || hasAssetPath("lodash")) {
    techs.push({ name: "Lodash", category: "Library", version: w._?.VERSION, confidence: "high" })
  }
  if (w.moment || hasAssetPath("moment")) {
    techs.push({ name: "Moment.js", category: "Library", confidence: "high" })
  }
  if (w.axios || hasAssetPath("axios")) {
    techs.push({ name: "Axios", category: "Library", confidence: "medium" })
  }
  if (w.io || hasAssetHost("socket.io") || hasAssetPath("/socket.io")) {
    techs.push({ name: "Socket.IO", category: "Realtime", confidence: "medium" })
  }
  if (w.Stripe || hasAssetHost("stripe.com")) {
    techs.push({ name: "Stripe", category: "Payments", confidence: "high" })
  }
  if (hasAssetHost("paypal.com", "paypalobjects.com")) {
    techs.push({ name: "PayPal", category: "Payments", confidence: "high" })
  }
  if (w.google?.maps || hasAssetHost("maps.googleapis.com")) {
    techs.push({ name: "Google Maps", category: "Maps", confidence: "high" })
  }
  if (w.mapboxgl || hasAssetHost("mapbox.com", "mapbox.cn")) {
    techs.push({ name: "Mapbox", category: "Maps", confidence: "high" })
  }
  if (w.L?.map || hasAssetPath("leaflet")) {
    techs.push({ name: "Leaflet", category: "Maps", confidence: "high" })
  }

  // Auth
  if (srcs.includes("auth0") || hasAssetHost("auth0.com")) {
    techs.push({ name: "Auth0", category: "Auth", confidence: "high" })
  }
  if (srcs.includes("clerk") || hasAssetHost("clerk.accounts.dev", "clerk.dev")) {
    techs.push({ name: "Clerk", category: "Auth", confidence: "high" })
  }
  if (hasSelector('meta[name="google-signin-client_id"]') || srcs.includes("accounts.google")) {
    techs.push({ name: "Google Sign-In", category: "Auth", confidence: "high" })
  }

  // Testing/Dev
  if (w.__STORYBOOK_ADDONS) {
    techs.push({ name: "Storybook", category: "Dev", confidence: "high" })
  }

  // PWA
  if (hasSelector('link[rel="manifest"]')) {
    techs.push({ name: "PWA", category: "Feature", confidence: "medium" })
  }

  // Fonts
  if (srcs.includes("fonts.googleapis") || srcs.includes("fonts.gstatic")) {
    techs.push({ name: "Google Fonts", category: "Font", confidence: "high" })
  }
  if (srcs.includes("use.typekit") || srcs.includes("adobe")) {
    techs.push({ name: "Adobe Fonts", category: "Font", confidence: "high" })
  }

  // Server hints
  const poweredBy = document.querySelector('meta[name="x-powered-by"]')?.getAttribute("content")
  if (poweredBy) {
    techs.push({ name: poweredBy, category: "Server", confidence: "medium" })
  }

  return dedupeTechs(techs)
}

function checkTailwindClasses(): boolean {
  const sample = document.querySelectorAll("[class]")
  let twCount = 0
  const twPattern = /\b(flex|grid|p-\d|m-\d|text-(sm|lg|xl)|bg-|rounded|border|shadow|w-|h-)\b/
  for (let i = 0; i < Math.min(sample.length, 50); i++) {
    const className = (sample[i] as HTMLElement).className
    const value = typeof className === "string" ? className : ""
    if (twPattern.test(value)) twCount++
  }
  return twCount > 10
}

function collectAssetUrls(): URL[] {
  const urls: URL[] = []
  const seen = new Set<string>()
  const add = (raw?: string | null) => {
    if (!raw) return
    try {
      const url = new URL(raw, window.location.href)
      if (seen.has(url.href)) return
      seen.add(url.href)
      urls.push(url)
    } catch {
      /* ignore invalid URLs */
    }
  }

  document
    .querySelectorAll("script[src], link[href], img[src], source[src], iframe[src], video[src]")
    .forEach((el) => add(el.getAttribute("src") || el.getAttribute("href")))

  try {
    performance.getEntriesByType("resource").forEach((entry) => add(entry.name))
  } catch {
    /* performance entries can be unavailable in restricted frames */
  }

  return urls
}

function safeQuery(selector: string): Element | null {
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

function dedupeTechs(techs: TechDetection[]): TechDetection[] {
  const byName = new Map<string, TechDetection>()
  for (const tech of techs) {
    const key = tech.name.toLowerCase()
    const current = byName.get(key)
    if (!current || confidenceRank(tech.confidence) > confidenceRank(current.confidence)) {
      byName.set(key, tech)
    }
  }
  return [...byName.values()].sort((a, b) => {
    const rank = confidenceRank(b.confidence) - confidenceRank(a.confidence)
    if (rank !== 0) return rank
    return a.name.localeCompare(b.name)
  })
}

function confidenceRank(confidence: TechDetection["confidence"]): number {
  if (confidence === "high") return 3
  if (confidence === "medium") return 2
  return 1
}

// Run detection and send to background
const techs = detectTechnologies()
if (techs.length > 0) {
  chrome.runtime.sendMessage({
    type: "TECH_DETECTED",
    techs,
    url: window.location.href,
    hostname: window.location.hostname
  })
}

// RSS/Atom feed detection
function detectFeeds(): { url: string; title: string; type: "rss" | "atom" | "json" }[] {
  const feeds: { url: string; title: string; type: "rss" | "atom" | "json" }[] = []
  const seen = new Set<string>()

  // Check <link> tags for feed autodiscovery
  const linkEls = document.querySelectorAll('link[type="application/rss+xml"], link[type="application/atom+xml"], link[type="application/feed+json"], link[type="application/json"][rel="alternate"]')
  linkEls.forEach((el) => {
    const href = el.getAttribute("href")
    if (!href) return
    const url = new URL(href, window.location.origin).href
    if (seen.has(url)) return
    seen.add(url)
    const type = el.getAttribute("type")
    let feedType: "rss" | "atom" | "json" = "rss"
    if (type?.includes("atom")) feedType = "atom"
    else if (type?.includes("json")) feedType = "json"
    feeds.push({ url, title: el.getAttribute("title") || "", type: feedType })
  })

  // Platform-specific feed detection
  const origin = window.location.origin
  const hostname = window.location.hostname
  const pathname = window.location.pathname

  // Substack: always has /feed
  if (hostMatches(hostname, "substack.com") || document.querySelector('meta[property="article:publisher"][content*="substack"]') || document.querySelector('script[src*="substack"]')) {
    const feedUrl = `${origin}/feed`
    if (!seen.has(feedUrl)) {
      seen.add(feedUrl)
      const name = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") || hostname
      feeds.push({ url: feedUrl, title: `${name} (Substack)`, type: "rss" })
    }
  }

  // Medium: /feed path or medium.com/feed/@user
  if (hostMatches(hostname, "medium.com") || document.querySelector('meta[property="al:android:package"][content="com.medium.reader"]')) {
    const ogUrl = document.querySelector('meta[property="og:url"]')?.getAttribute("content") || ""
    if (hostname === "medium.com") {
      // medium.com/@user or medium.com/publication
      const match = pathname.match(/^\/@([^/]+)/) || pathname.match(/^\/([^/@][^/]+)/)
      if (match) {
        const feedUrl = `https://medium.com/feed/${match[0]}`
        if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: `Medium ${match[0]}`, type: "rss" }) }
      }
    } else {
      // Custom domain on Medium
      const feedUrl = `${origin}/feed`
      if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: `${hostname} (Medium)`, type: "rss" }) }
    }
  }

  // WordPress: /feed/ is standard
  if (document.querySelector('meta[name="generator"][content*="WordPress"]') || (window as any).wp) {
    const feedUrl = `${origin}/feed/`
    if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: `${hostname} (WordPress)`, type: "rss" }) }
  }

  // Ghost: standard /rss/
  if (document.querySelector('meta[name="generator"][content*="Ghost"]') || (window as any).ghost) {
    const feedUrl = `${origin}/rss/`
    if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: `${hostname} (Ghost)`, type: "rss" }) }
  }

  // Blogger/Blogspot
  if (hostMatches(hostname, "blogspot.com") || hostMatches(hostname, "blogger.com")) {
    const feedUrl = `${origin}/feeds/posts/default`
    if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: `${hostname} (Blogger)`, type: "atom" }) }
  }

  // YouTube: channel/playlist feeds
  if (hostMatches(hostname, "youtube.com")) {
    const channelId = document.querySelector('meta[itemprop="channelId"]')?.getAttribute("content")
      || document.querySelector('link[rel="canonical"]')?.getAttribute("href")?.match(/channel\/(UC[a-zA-Z0-9_-]+)/)?.[1]
    if (channelId) {
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
      if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: "YouTube Channel", type: "atom" }) }
    }
    const playlistMatch = window.location.href.match(/list=([a-zA-Z0-9_-]+)/)
    if (playlistMatch) {
      const feedUrl = `https://www.youtube.com/feeds/videos.xml?playlist_id=${playlistMatch[1]}`
      if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: "YouTube Playlist", type: "atom" }) }
    }
  }

  // GitHub: repo releases/commits
  if (hostname === "github.com") {
    const repoMatch = pathname.match(/^\/([^/]+\/[^/]+)/)
    if (repoMatch) {
      const repo = repoMatch[1]
      const releaseFeed = `https://github.com/${repo}/releases.atom`
      const commitFeed = `https://github.com/${repo}/commits.atom`
      if (!seen.has(releaseFeed)) { seen.add(releaseFeed); feeds.push({ url: releaseFeed, title: `${repo} Releases`, type: "atom" }) }
      if (!seen.has(commitFeed)) { seen.add(commitFeed); feeds.push({ url: commitFeed, title: `${repo} Commits`, type: "atom" }) }
    }
  }

  // Reddit: append .rss to any reddit URL
  if (hostMatches(hostname, "reddit.com")) {
    const subredditMatch = pathname.match(/^\/r\/([^/]+)/)
    if (subredditMatch) {
      const feedUrl = `https://www.reddit.com/r/${subredditMatch[1]}/.rss`
      if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: `r/${subredditMatch[1]}`, type: "rss" }) }
    }
  }

  // Fallback: scan page links for feed URLs
  if (feeds.length === 0) {
    const anchors = document.querySelectorAll("a[href]")
    anchors.forEach((a) => {
      const href = (a as HTMLAnchorElement).href
      if (seen.has(href)) return
      const lower = href.toLowerCase()
      if (lower.includes("/feed") || lower.includes("/rss") || lower.includes("atom.xml") || lower.includes(".rss") || lower.endsWith("/rss/")) {
        seen.add(href)
        feeds.push({ url: href, title: (a as HTMLAnchorElement).textContent?.trim() || "Feed", type: "rss" })
      }
    })
  }

  return feeds
}

const feeds = detectFeeds()
if (feeds.length > 0) {
  chrome.runtime.sendMessage({ type: "FEEDS_DETECTED", feeds, hostname: window.location.hostname })
}

// Listen for requests from popup/dashboard
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "GET_TECH") {
    sendResponse({ techs: detectTechnologies() })
  }
  if (message.type === "GET_FEEDS") {
    sendResponse({ feeds: detectFeeds() })
  }
})
