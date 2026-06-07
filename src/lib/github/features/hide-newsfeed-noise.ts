// src/lib/github/features/hide-newsfeed-noise.ts
// Declutter the GitHub dashboard activity feed by hiding low-signal items:
// starred-repo activity, follow-user events, fork events, and sponsored cards.
// CSS-only, defensive selectors.
import { injectStyle, removeStyle } from "../dom"
import { isDashboard } from "../page-detect"
import type { FeatureMeta } from "../registry"

const KEY = "hide-newsfeed-noise"

const CSS = `
/* Sponsored / marketplace cards in the feed */
.js-sponsored-activity,
[data-hydro-view*="marketplace"],
/* "X starred Y" events */
.js-feed-item-component:has([id^="star-"]),
/* "X followed Y" events */
.js-feed-item-component:has([id^="follow-"]),
/* Fork events */
.js-feed-item-component:has([id^="fork-"]),
/* Release events that are just noise */
.js-feed-item-component:has([id^="release-"]),
/* "X created a repository" with no useful content */
.js-feed-item-component:has([id^="create-"]) .body:empty
{ display: none !important; }
`

const feature: FeatureMeta = {
  id: KEY,
  name: "Hide newsfeed noise",
  description: "Declutter the dashboard feed by hiding low-signal activity (stars, follows, forks, sponsor promos).",
  category: "global",
  defaultEnabled: true,
  pageTest: (url) => isDashboard(url),
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })
  }
}

export default feature
