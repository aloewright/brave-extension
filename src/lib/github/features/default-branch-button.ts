// src/lib/github/features/default-branch-button.ts
// Ported from RGH default-branch-button.tsx.
// Adds a chevron-left link beside the branch selector to jump back to the
// default branch when viewing a non-default branch. Requires a token to
// look up the default branch via GET /repos/{owner}/{name}.
import { el, injectStyle } from "../dom"
import { observe } from "../observe"
import { isRepoRoot, isSingleFile, isRepo } from "../page-detect"
import { parseRepo } from "../repo"
import { v3, hasToken } from "../api"
import type { FeatureMeta } from "../registry"

const KEY = "default-branch-button"

// CSS ported from RGH default-branch-button.css — highlights the branch
// selector when you're on a non-default branch.
const CSS = `
button.rgh-highlight-non-default-branch,
details.rgh-highlight-non-default-branch > summary {
  background-color: var(--bgColor-accent-muted, var(--color-accent-subtle)) !important;
  color: var(--fgColor-accent, var(--color-accent-fg)) !important;
  border-color: var(--fgColor-accent, var(--color-accent-fg)) !important;
}
button.rgh-highlight-non-default-branch svg,
details.rgh-highlight-non-default-branch > summary svg {
  color: var(--fgColor-accent, var(--color-accent-fg)) !important;
}
.rgh-default-branch-button {
  display: inline-flex;
  align-items: center;
}
`

// RGH selectors from branchSelector helper:
// 'summary[data-hotkey="w"]' (details-based) and
// '[data-testid="branch-name-drop-target"]' (React-based)
const BRANCH_SELECTORS = [
  'summary[data-hotkey="w"]',
  '[data-testid="branch-name-drop-target"]',
].join(", ")

async function getDefaultBranch(owner: string, name: string): Promise<string> {
  const data = await v3<{ default_branch: string }>(`/repos/${owner}/${name}`)
  return data.default_branch
}

function buildDefaultBranchUrl(defaultBranch: string): string {
  const url = new URL(location.href)
  const parts = url.pathname.split("/").filter(Boolean)
  // parts: [owner, name, kind?, ref?, ...rest]
  if (parts.length < 2) return `/${parts[0]}/${parts[1]}/`
  const [owner, name, kind, , ...rest] = parts
  if (isRepoRoot(url)) {
    return `/${owner}/${name}/`
  }
  if (kind === "blob" || kind === "tree" || kind === "commits") {
    return `/${owner}/${name}/${kind}/${defaultBranch}/${rest.join("/")}`
  }
  return `/${owner}/${name}/tree/${defaultBranch}`
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Default branch button",
  description: "Adds a button to jump back to the default branch when viewing a non-default branch.",
  category: "repository",
  defaultEnabled: true,
  needsToken: true,
  pageTest: (url) => isRepo(url),
  init: async (signal) => {
    if (!(await hasToken())) return

    injectStyle(KEY, CSS)
    signal.addEventListener("abort", () => {
      document.querySelector(`style[data-rgh="${KEY}"]`)?.remove()
    }, { once: true })

    observe(BRANCH_SELECTORS, async (branchEl) => {
      const parent = branchEl.parentElement
      if (!parent) return
      // The button is inserted before selectorTarget, so check the grandparent
      const selectorTargetForCheck = branchEl.tagName === "SUMMARY" ? parent : branchEl as HTMLElement
      const insertionParent = selectorTargetForCheck.parentElement
      if (insertionParent?.querySelector(".rgh-default-branch-button")) return

      const info = parseRepo(new URL(location.href))
      if (!info) return

      let defaultBranch: string
      try {
        defaultBranch = await getDefaultBranch(info.owner, info.name)
      } catch {
        return
      }

      // Determine current branch from the selector text
      const currentBranch = (branchEl as HTMLElement).textContent?.trim() ?? ""
      if (currentBranch === defaultBranch) return

      // Highlight the branch selector to indicate non-default
      const selectorTarget = branchEl.tagName === "SUMMARY"
        ? branchEl.parentElement!
        : branchEl as HTMLElement
      selectorTarget.classList.add("rgh-highlight-non-default-branch")

      const href = buildDefaultBranchUrl(defaultBranch)
      const link = el("a", {
        className: "btn px-2 rgh-default-branch-button",
        href,
        title: "View on the default branch",
        ariaLabel: "View on the default branch",
      }, "←")

      selectorTarget.before(link)
    }, { signal })
  }
}

export default feature
