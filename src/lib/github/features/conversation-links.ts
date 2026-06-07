// src/lib/github/features/conversation-links.ts
// Ported from RGH linkify-branch-references.tsx.
// Linkifies plain-text branch/ref name elements on PR pages so they become
// clickable links to the branch tree view. No token needed — all data is
// in the DOM (owner/name from URL, branch from element text).
import { el } from "../dom"
import { observe } from "../observe"
import { isPR } from "../page-detect"
import { parseRepo } from "../repo"
import type { FeatureMeta } from "../registry"

const KEY = "conversation-links"

// RGH selectors (from linkify-branch-references.tsx):
// '.branch-name' — quick-PR page branch label (pre-React)
// '[data-hydro-view*="pull-request-hovercard-hover"] ~ .d-flex.mt-2' — hovercard branch refs
// '.commit-ref' with child '.user' + title — hovercard cross-repo refs
//
// On PR conversation pages GitHub also renders '.commit-ref' elements for
// head and base branch labels in the merge box.
const BRANCH_NAME_SELECTOR = ".branch-name"
const COMMIT_REF_SELECTOR = ".commit-ref:not(.rgh-conversation-links)"

function buildBranchUrl(owner: string, name: string, branch: string): string {
  return `https://github.com/${owner}/${name}/tree/${encodeURIComponent(branch)}`
}

function linkifyBranchName(element: Element): void {
  if (element.querySelector("a")) return  // already linked
  if ((element as HTMLElement).closest?.("a")) return  // already inside a link
  const branch = element.textContent?.trim()
  if (!branch) return
  const info = parseRepo(new URL(location.href))
  if (!info) return
  const href = buildBranchUrl(info.owner, info.name, branch)
  const link = el("a", {
    className: "no-underline",
    href,
  }, branch)
  // Replace text content with the link safely (no innerHTML)
  element.textContent = ""
  element.append(link)
  ;(element as HTMLElement).dataset.rghConversationLinks = "1"
}

function linkifyCommitRef(element: Element): void {
  if (element.querySelector("a")) return
  if ((element as HTMLElement).closest?.("a")) return
  element.classList.add("rgh-conversation-links")

  // RGH uses element.title for cross-repo refs; fall back to textContent
  const branch = (element as HTMLElement).title?.trim() || element.textContent?.trim()
  if (!branch) return

  // Detect cross-repo: RGH looks for a .user child element
  const userEl = element.querySelector(".user")
  const info = parseRepo(new URL(location.href))
  if (!info) return

  let owner = info.owner
  let name = info.name
  if (userEl) {
    // Cross-repo format: "owner/name:branch" or user prefix in DOM
    const userText = userEl.textContent?.trim()
    if (userText) {
      const parts = userText.split("/")
      if (parts.length === 2) { owner = parts[0]; name = parts[1] }
    }
  }

  const href = buildBranchUrl(owner, name, branch)
  // Wrap existing child nodes in a link
  const childNodes = [...element.childNodes]
  const link = el("a", { className: "no-underline", href })
  for (const node of childNodes) link.appendChild(node)
  element.append(link)
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Conversation links",
  description: "Linkifies branch/ref name mentions on pull request pages.",
  category: "pull-requests",
  defaultEnabled: true,
  pageTest: (url) => isPR(url),
  init: (signal) => {
    // .branch-name: quick-PR page branch labels (RGH linkifyQuickPr)
    observe(BRANCH_NAME_SELECTOR, (el) => {
      if ((el as HTMLElement).dataset.rghConversationLinks) return
      linkifyBranchName(el)
    }, { signal })

    // .commit-ref: branch labels in the merge box and timeline events
    observe(COMMIT_REF_SELECTOR, (el) => {
      linkifyCommitRef(el)
    }, { signal })
  }
}

export default feature
