// src/lib/github/features/selectable-comment-quotes.ts
// GitHub's comment blockquotes have user-select:none in some themes; this
// makes them text-selectable again.
// CSS-only, applies on all pages.
import { injectStyle, removeStyle } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "selectable-comment-quotes"

const CSS = `
/* Re-enable text selection on blockquotes inside GitHub comments */
.comment-body blockquote,
.markdown-body blockquote,
.timeline-comment-group blockquote
{
  user-select: text !important;
  -webkit-user-select: text !important;
}
`

const feature: FeatureMeta = {
  id: KEY,
  name: "Selectable comment quotes",
  description: "Allow text selection inside blockquotes in GitHub comments and issues.",
  category: "global",
  defaultEnabled: true,
  pageTest: () => true,
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })
  }
}

export default feature
