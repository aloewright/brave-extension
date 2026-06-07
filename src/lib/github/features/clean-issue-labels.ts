// src/lib/github/features/clean-issue-labels.ts
// Port of RGH align-issue-labels.css + align-issue-labels.tsx
// Moves issue/PR labels below the title for better readability.

import { injectStyle, removeStyle } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "clean-issue-labels"

// Verbatim selectors from RGH align-issue-labels.css (both new module-based and legacy .js-issue-row)
const CSS = `
html:not([rgh-OFF-clean-issue-labels]) {
  div[class^='IssueRow-module__row'],
  div[class^='PullRequestRow-module__row'],
  li[class*='PullsListItem']:not([class*='compact']) {
    div[class^='Title-module__container'] {
      display: contents;
    }
    div[class^='Title-module__container'] > [class*='heading'] {
      grid-area: primary;
      padding-top: 8px;
    }
    div[class^='Title-module__container'] > span[class*='trailingBadgesSpacer'] {
      display: none;
    }
    div[class^='Title-module__container'] > span[class*='trailingBadgesContainer'] {
      grid-area: -1 / main-content;
      padding-bottom: 10px;
    }
    div[class^='Title-module__container'] > span[class*='trailingBadgesContainer']:empty {
      padding-bottom: 6px;
    }
    div[class^='Title-module__container'] > span[class*='trailingBadgesContainer']:is(li[class*='PullsListItem'] *) {
      margin-top: -4px;
    }
    div[class^='MetadataContainer-module__container']:is(li[class*='PullsListItem'] *) {
      padding-top: 8px;
    }
    div[class^='MainContent-module__inner'] {
      padding-bottom: 0;
    }
  }

  /* Old view — legacy PR/issue list */
  .js-issue-row .min-width-0 {
    display: flex;
    flex-wrap: wrap;
  }
  .js-issue-row .min-width-0 > .lh-default {
    order: 1;
  }
  .js-issue-row .min-width-0 .text-small {
    flex-basis: 100%;
  }
  .js-issue-row .commit-build-statuses {
    margin-left: 4px;
  }
  .js-issue-row .mt-1.text-small.color-fg-muted {
    flex-basis: 100%;
  }
  .js-issue-row .h4 {
    max-width: 100%;
  }
  .js-issue-row .IssueLabel {
    margin-top: 4px;
    font-size: 11px !important;
  }
}
`

const feature: FeatureMeta = {
  id: KEY,
  name: "Clean issue labels",
  description: "Moves labels below the issue/PR title for cleaner list views.",
  category: "issues",
  defaultEnabled: true,
  pageTest: () => true,
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })
  }
}

export default feature
