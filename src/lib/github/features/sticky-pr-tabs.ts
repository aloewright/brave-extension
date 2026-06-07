// src/lib/github/features/sticky-pr-tabs.ts
// Port of RGH sticky-conversation-list-toolbar.css
// Makes the issues/PR list toolbar sticky so filters stay visible while scrolling.

import { injectStyle, removeStyle } from "../dom"
import { isPR } from "../page-detect"
import type { FeatureMeta } from "../registry"

const KEY = "sticky-pr-tabs"

// Verbatim selectors from RGH sticky-conversation-list-toolbar.css
const CSS = `
/* Sticky table header on issues list */
/* https://github.com/refined-github/refined-github/issues */
.Box-header#js-issues-toolbar,
/* https://github.com/issues */
.Box#js-issues-toolbar > .Box-header {
  position: sticky;
  top: 0;
  z-index: 25; /* Must be above .modal-backdrop (z-index 20) #1317 */
}
`

const feature: FeatureMeta = {
  id: KEY,
  name: "Sticky PR tabs",
  description: "Keeps the PR/issues list toolbar pinned while scrolling.",
  category: "pull-requests",
  defaultEnabled: true,
  pageTest: (url) => isPR(url),
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })
  }
}

export default feature
