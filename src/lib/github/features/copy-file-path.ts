// src/lib/github/features/copy-file-path.ts
import { el } from "../dom"
import { observe } from "../observe"
import { isSingleFile } from "../page-detect"
import { parseRepo } from "../repo"
import type { FeatureMeta } from "../registry"

const KEY = "copy-file-path"

const feature: FeatureMeta = {
  id: KEY,
  name: "Copy file path",
  description: "Button to copy the current file's repo-relative path.",
  category: "repository",
  defaultEnabled: true,
  pageTest: (url) => isSingleFile(url),
  init: (signal) => {
    observe(".file-actions", (container) => {
      if (container.querySelector(`.${"rgh-copy-file-path"}`)) return
      const info = parseRepo(new URL(location.href))
      if (!info?.filePath) return
      const button = el("button", {
        className: "btn btn-sm rgh-copy-file-path",
        type: "button",
        title: "Copy file path",
        onclick: () => void navigator.clipboard.writeText(info.filePath!)
      }, "Copy path")
      container.prepend(button)
    }, { signal })
  }
}

export default feature
