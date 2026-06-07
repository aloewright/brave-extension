// src/lib/github/features/clean-sidebar.ts
// Hides promotional/dashboard widgets cluttering the GitHub sidebar.
// CSS-only, defensive selectors — missing selectors are harmless.
import { injectStyle, removeStyle } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "clean-sidebar"

// Targets GitHub's right-hand sidebar widgets on dashboard and repo pages.
// These selectors hide "Explore repositories", "Latest changes", sponsored
// content, and other promotional panels that dilute signal.
const CSS = `
/* Hide "Explore repositories" panel */
[aria-label="Explore repositories"],
div[data-board-id],
.js-feed-item-component[data-hovercard-url*="/sponsors/"],
/* Sponsored feed items */
.js-sponsored-activity,
/* "Discover repositories" sidebar panel */
.dashboard-sidebar [class*="explore"],
.dashboard-sidebar .js-repos-explore-section,
/* Trending / marketplace promos */
aside[aria-label="Trending repositories"],
.feed-right-sidebar .sidebar-widget:has([href*="/trending"]),
.feed-right-sidebar .sidebar-widget:has([href*="/marketplace"]),
/* "GitHub Sponsors" sidebar promo */
.feed-right-sidebar .sidebar-widget:has([href*="/sponsors"])
{ display: none !important; }
`

const feature: FeatureMeta = {
  id: KEY,
  name: "Clean sidebar",
  description: "Hide promotional and noise widgets from the GitHub sidebar.",
  category: "global",
  defaultEnabled: true,
  pageTest: () => true,
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })
  }
}

export default feature
