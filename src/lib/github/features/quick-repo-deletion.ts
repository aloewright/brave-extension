// src/lib/github/features/quick-repo-deletion.ts
import { observe } from "../observe"
import { isRepo } from "../page-detect"
import { parseRepo } from "../repo"
import type { FeatureMeta } from "../registry"

const KEY = "quick-repo-deletion"

const feature: FeatureMeta = {
  id: KEY,
  name: "Quick repo deletion",
  description:
    "Adds a delete shortcut that routes to the Danger Zone and pre-fills the " +
    "confirmation. You still click the final native Delete button.",
  category: "write-actions",
  defaultEnabled: false,
  isWrite: true,
  writeScopes: ["delete_repo"],
  confirm: "Open the Danger Zone to delete this repository? You will still confirm the final deletion yourself.",
  pageTest: (url) => isRepo(url),
  init: (signal) => {
    // When on the settings page, pre-fill the confirmation field GitHub shows.
    observe(".js-repo-delete-proceed-confirmation", (node) => {
      const info = parseRepo(new URL(location.href))
      if (!info) return
      const field = node as HTMLInputElement
      if (!field.value) {
        field.value = info.nameWithOwner
        field.dispatchEvent(new Event("input", { bubbles: true }))
      }
    }, { signal })
    // The trigger button is added in a live step (selector verification needed);
    // unit scope here is the auto-fill behavior above.
  }
}

export default feature
