// src/lib/github/features/sticky-file-headers.ts
import { injectStyle, removeStyle } from "../dom"
import { isPRFiles, isCommit, isSingleFile } from "../page-detect"
import type { FeatureMeta } from "../registry"

const KEY = "sticky-file-headers"
const CSS = `
.file-header { position: sticky; top: 0; z-index: 1; }
`

const feature: FeatureMeta = {
  id: KEY,
  name: "Sticky file headers",
  description: "Keep each file's header pinned while scrolling diffs.",
  category: "repository",
  defaultEnabled: true,
  pageTest: (url) => isPRFiles(url) || isCommit(url) || isSingleFile(url),
  init: (signal) => {
    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => removeStyle(KEY), { once: true })
  }
}

export default feature
