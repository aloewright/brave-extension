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

function detectTechnologies(): TechDetection[] {
  const techs: TechDetection[] = []
  const w = window as any
  const html = document.documentElement.outerHTML
  const scriptEls = Array.from(document.querySelectorAll("script[src], link[href]"))
  const srcs = scriptEls.map((s) => s.getAttribute("src") || s.getAttribute("href") || "").join(" ").toLowerCase()

  // Frameworks
  if (w.__NEXT_DATA__ || document.querySelector("#__next")) {
    const ver = w.__NEXT_DATA__?.buildId ? undefined : undefined
    techs.push({ name: "Next.js", category: "Framework", confidence: "high" })
  }
  if (w.__NUXT__ || w.__nuxt__) {
    techs.push({ name: "Nuxt.js", category: "Framework", confidence: "high" })
  }
  if (w.Remix || document.querySelector('[data-remix-run]')) {
    techs.push({ name: "Remix", category: "Framework", confidence: "high" })
  }
  if (w.__GATSBY) {
    techs.push({ name: "Gatsby", category: "Framework", confidence: "high" })
  }
  if (w.Astro || document.querySelector('[data-astro-cid]') || document.querySelector('astro-island')) {
    techs.push({ name: "Astro", category: "Framework", confidence: "high" })
  }
  if (document.querySelector('[data-sveltekit]') || document.querySelector('[data-svelte]')) {
    techs.push({ name: "SvelteKit", category: "Framework", confidence: "high" })
  }

  // UI Libraries
  if (w.React || w.__REACT_DEVTOOLS_GLOBAL_HOOK__ || document.querySelector("[data-reactroot]") || document.querySelector("[data-reactid]")) {
    techs.push({ name: "React", category: "UI Library", confidence: "high" })
  }
  if (w.Vue || document.querySelector("[data-v-]") || document.querySelector("[v-cloak]")) {
    techs.push({ name: "Vue.js", category: "UI Library", confidence: "high" })
  }
  if (w.angular || document.querySelector("[ng-version]") || document.querySelector("[_nghost-]")) {
    const ver = document.querySelector("[ng-version]")?.getAttribute("ng-version")
    techs.push({ name: "Angular", category: "UI Library", version: ver || undefined, confidence: "high" })
  }
  if (w.Svelte || document.querySelector(".svelte-")) {
    techs.push({ name: "Svelte", category: "UI Library", confidence: "medium" })
  }
  if (w.htmx) {
    techs.push({ name: "htmx", category: "UI Library", confidence: "high" })
  }
  if (w.Alpine) {
    techs.push({ name: "Alpine.js", category: "UI Library", confidence: "high" })
  }

  // CSS
  if (document.querySelector('link[href*="tailwind"]') || html.includes("tailwindcss") || checkTailwindClasses()) {
    techs.push({ name: "Tailwind CSS", category: "CSS", confidence: "medium" })
  }
  if (document.querySelector('link[href*="bootstrap"]') || w.bootstrap) {
    techs.push({ name: "Bootstrap", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('[class*="chakra-"]')) {
    techs.push({ name: "Chakra UI", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('[class*="MuiBox"]') || document.querySelector('[class*="css-"][class*="MuiButton"]')) {
    techs.push({ name: "Material UI", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('[class*="ant-"]')) {
    techs.push({ name: "Ant Design", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('[class*="mantine-"]')) {
    techs.push({ name: "Mantine", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('[class*="radix-"]') || document.querySelector('[data-radix-collection-item]')) {
    techs.push({ name: "Radix UI", category: "CSS", confidence: "high" })
  }
  if (srcs.includes("styled-components") || document.querySelector('style[data-styled]')) {
    techs.push({ name: "styled-components", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('[class*="emotion-"]') || document.querySelector('style[data-emotion]')) {
    techs.push({ name: "Emotion", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('link[href*="bulma"]') || document.querySelector('.bulma')) {
    techs.push({ name: "Bulma", category: "CSS", confidence: "high" })
  }
  if (document.querySelector('[class*="foundation-"]') || w.Foundation) {
    techs.push({ name: "Foundation", category: "CSS", confidence: "high" })
  }

  // State Management
  if (w.__REDUX_DEVTOOLS_EXTENSION__ || w.__REDUX_STORE__) {
    techs.push({ name: "Redux", category: "State", confidence: "medium" })
  }
  if (w.__MOBX_DEVTOOLS_GLOBAL_HOOK__ || w.mobx) {
    techs.push({ name: "MobX", category: "State", confidence: "medium" })
  }
  if (document.querySelector("[data-rk]") || w.zustand) {
    techs.push({ name: "Zustand", category: "State", confidence: "low" })
  }

  // Analytics & Services
  if (w.gtag || w.ga || w.google_tag_manager) {
    techs.push({ name: "Google Analytics", category: "Analytics", confidence: "high" })
  }
  if (w.google_tag_manager || document.querySelector('script[src*="googletagmanager"]')) {
    techs.push({ name: "Google Tag Manager", category: "Analytics", confidence: "high" })
  }
  if (w.mixpanel) {
    techs.push({ name: "Mixpanel", category: "Analytics", confidence: "high" })
  }
  if (w.Sentry) {
    techs.push({ name: "Sentry", category: "Monitoring", confidence: "high" })
  }
  if (w.amplitude) {
    techs.push({ name: "Amplitude", category: "Analytics", confidence: "high" })
  }
  if (w.Intercom) {
    techs.push({ name: "Intercom", category: "Support", confidence: "high" })
  }
  if (w.drift) {
    techs.push({ name: "Drift", category: "Support", confidence: "high" })
  }
  if (w.Crisp) {
    techs.push({ name: "Crisp", category: "Support", confidence: "high" })
  }
  if (w.zE || document.querySelector("#ze-snippet")) {
    techs.push({ name: "Zendesk", category: "Support", confidence: "high" })
  }
  if (w.HubSpotConversations || document.querySelector('script[src*="hubspot"]')) {
    techs.push({ name: "HubSpot", category: "Marketing", confidence: "high" })
  }
  if (w.hj || document.querySelector('script[src*="hotjar"]')) {
    techs.push({ name: "Hotjar", category: "Analytics", confidence: "high" })
  }
  if (w.Segment || w.analytics?.identify) {
    techs.push({ name: "Segment", category: "Analytics", confidence: "medium" })
  }
  if (w.posthog || document.querySelector('script[src*="posthog"]')) {
    techs.push({ name: "PostHog", category: "Analytics", confidence: "high" })
  }
  if (w.plausible || document.querySelector('script[src*="plausible"]')) {
    techs.push({ name: "Plausible", category: "Analytics", confidence: "high" })
  }
  if (document.querySelector('script[src*="cloudflareinsights"]') || w.__cfBeacon) {
    techs.push({ name: "Cloudflare Web Analytics", category: "Analytics", confidence: "high" })
  }
  if (document.querySelector('[data-nextjs-scroll-focus-boundary]')) {
    techs.push({ name: "Next.js App Router", category: "Framework", confidence: "high" })
  }

  // Hosting / CDN / CMS
  if (document.querySelector('meta[name="generator"][content*="WordPress"]') || w.wp) {
    techs.push({ name: "WordPress", category: "CMS", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Drupal"]')) {
    techs.push({ name: "Drupal", category: "CMS", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Joomla"]')) {
    techs.push({ name: "Joomla", category: "CMS", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Ghost"]') || w.ghost) {
    techs.push({ name: "Ghost", category: "CMS", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Hugo"]')) {
    techs.push({ name: "Hugo", category: "SSG", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Jekyll"]')) {
    techs.push({ name: "Jekyll", category: "SSG", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Shopify"]') || w.Shopify) {
    techs.push({ name: "Shopify", category: "Platform", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Webflow"]')) {
    techs.push({ name: "Webflow", category: "Platform", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Squarespace"]')) {
    techs.push({ name: "Squarespace", category: "Platform", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Wix"]') || w.wixBiSession) {
    techs.push({ name: "Wix", category: "Platform", confidence: "high" })
  }
  if (document.querySelector('meta[name="generator"][content*="Framer"]') || w.__framer) {
    techs.push({ name: "Framer", category: "Platform", confidence: "high" })
  }
  if (w.Notion || document.querySelector('meta[property="og:site_name"][content="Notion"]')) {
    techs.push({ name: "Notion", category: "Platform", confidence: "high" })
  }

  // CDN / Hosting
  if (srcs.includes("cloudflare") || srcs.includes("cdnjs.cloudflare")) {
    techs.push({ name: "Cloudflare CDN", category: "CDN", confidence: "medium" })
  }
  if (srcs.includes("unpkg.com")) {
    techs.push({ name: "unpkg", category: "CDN", confidence: "high" })
  }
  if (srcs.includes("jsdelivr")) {
    techs.push({ name: "jsDelivr", category: "CDN", confidence: "high" })
  }
  if (srcs.includes("vercel") || document.querySelector('meta[name="x-vercel-id"]')) {
    techs.push({ name: "Vercel", category: "Hosting", confidence: "high" })
  }
  if (srcs.includes("netlify") || document.querySelector('meta[name="generator"][content*="Netlify"]')) {
    techs.push({ name: "Netlify", category: "Hosting", confidence: "high" })
  }
  if (document.querySelector('meta[name="firebase-app"]') || srcs.includes("firebase")) {
    techs.push({ name: "Firebase", category: "Backend", confidence: "medium" })
  }
  if (srcs.includes("supabase")) {
    techs.push({ name: "Supabase", category: "Backend", confidence: "medium" })
  }
  if (srcs.includes("aws") || srcs.includes("amazonaws")) {
    techs.push({ name: "AWS", category: "Cloud", confidence: "medium" })
  }

  // JavaScript Libraries
  if (w.jQuery || w.$?.fn?.jquery) {
    const ver = w.jQuery?.fn?.jquery || w.$?.fn?.jquery
    techs.push({ name: "jQuery", category: "Library", version: ver, confidence: "high" })
  }
  if (w.gsap || w.TweenMax) {
    techs.push({ name: "GSAP", category: "Animation", confidence: "high" })
  }
  if (w.THREE) {
    techs.push({ name: "Three.js", category: "3D", confidence: "high" })
  }
  if (w.d3) {
    techs.push({ name: "D3.js", category: "Visualization", confidence: "high" })
  }
  if (w.Chart) {
    techs.push({ name: "Chart.js", category: "Visualization", confidence: "high" })
  }
  if (w.Highcharts) {
    techs.push({ name: "Highcharts", category: "Visualization", confidence: "high" })
  }
  if (w.Lodash || w._?.VERSION) {
    techs.push({ name: "Lodash", category: "Library", version: w._?.VERSION, confidence: "high" })
  }
  if (w.moment) {
    techs.push({ name: "Moment.js", category: "Library", confidence: "high" })
  }
  if (w.axios) {
    techs.push({ name: "Axios", category: "Library", confidence: "medium" })
  }
  if (w.io || srcs.includes("socket.io")) {
    techs.push({ name: "Socket.IO", category: "Realtime", confidence: "medium" })
  }
  if (w.Stripe || srcs.includes("stripe.com")) {
    techs.push({ name: "Stripe", category: "Payments", confidence: "high" })
  }
  if (srcs.includes("paypal")) {
    techs.push({ name: "PayPal", category: "Payments", confidence: "high" })
  }
  if (w.google?.maps || srcs.includes("maps.googleapis")) {
    techs.push({ name: "Google Maps", category: "Maps", confidence: "high" })
  }
  if (w.mapboxgl || srcs.includes("mapbox")) {
    techs.push({ name: "Mapbox", category: "Maps", confidence: "high" })
  }
  if (w.L?.map || srcs.includes("leaflet")) {
    techs.push({ name: "Leaflet", category: "Maps", confidence: "high" })
  }

  // Auth
  if (srcs.includes("auth0")) {
    techs.push({ name: "Auth0", category: "Auth", confidence: "high" })
  }
  if (srcs.includes("clerk")) {
    techs.push({ name: "Clerk", category: "Auth", confidence: "high" })
  }
  if (document.querySelector('meta[name="google-signin-client_id"]') || srcs.includes("accounts.google")) {
    techs.push({ name: "Google Sign-In", category: "Auth", confidence: "high" })
  }

  // Testing/Dev
  if (w.__STORYBOOK_ADDONS) {
    techs.push({ name: "Storybook", category: "Dev", confidence: "high" })
  }

  // PWA
  if (document.querySelector('link[rel="manifest"]')) {
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

  return techs
}

function checkTailwindClasses(): boolean {
  const sample = document.querySelectorAll("[class]")
  let twCount = 0
  const twPattern = /\b(flex|grid|p-\d|m-\d|text-(sm|lg|xl)|bg-|rounded|border|shadow|w-|h-)\b/
  for (let i = 0; i < Math.min(sample.length, 50); i++) {
    if (twPattern.test(sample[i].className)) twCount++
  }
  return twCount > 10
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
  if (hostname.includes("substack.com") || document.querySelector('meta[property="article:publisher"][content*="substack"]') || document.querySelector('script[src*="substack"]')) {
    const feedUrl = `${origin}/feed`
    if (!seen.has(feedUrl)) {
      seen.add(feedUrl)
      const name = document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") || hostname
      feeds.push({ url: feedUrl, title: `${name} (Substack)`, type: "rss" })
    }
  }

  // Medium: /feed path or medium.com/feed/@user
  if (hostname.includes("medium.com") || document.querySelector('meta[property="al:android:package"][content="com.medium.reader"]')) {
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
  if (hostname.includes("blogspot.com") || hostname.includes("blogger.com")) {
    const feedUrl = `${origin}/feeds/posts/default`
    if (!seen.has(feedUrl)) { seen.add(feedUrl); feeds.push({ url: feedUrl, title: `${hostname} (Blogger)`, type: "atom" }) }
  }

  // YouTube: channel/playlist feeds
  if (hostname.includes("youtube.com")) {
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
  if (hostname.includes("reddit.com")) {
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
