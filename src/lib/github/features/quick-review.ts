// src/lib/github/features/quick-review.ts
// Ported from RGH quick-review.tsx
// Adds a "review now" link and "approve now" button to the PR sidebar Reviewers section.
// "review now" is a pure navigation link. "approve now" POSTs to the v3 reviews endpoint via the
// shared api helper, which attaches the Doppler PAT if one is loaded. We keep needsToken: false
// because the link/button are useful without a PAT; if no token is present the approve POST will
// fail with 401 and we surface that to the user. Approving is confirm-gated (Alt skips the gate).
import { observe } from "../observe"
import { isPR, isPRFiles } from "../page-detect"
import { v3 } from "../api"
import { el } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "quick-review"

function getConversationNumber(): string | null {
  const m = location.pathname.match(/\/pull\/(\d+)/)
  return m ? m[1] : null
}

function getLoggedInUser(): string {
  return document.querySelector<HTMLElement>("meta[name='user-login']")?.getAttribute("content") ?? ""
}

function getPrAuthor(): string {
  return (
    document.querySelector<HTMLElement>(".author")?.textContent?.trim() ??
    document.querySelector<HTMLElement>('[data-testid="author-association-label"]')?.closest("a")?.textContent?.trim() ??
    ""
  )
}

async function approveNow(e: MouseEvent): Promise<void> {
  e.preventDefault()
  const isAlt = e.altKey
  let message = ""
  if (!isAlt) {
    // Confirm gate (matches feature.confirm) before any optional message prompt.
    if (!window.confirm(feature.confirm!)) return
    const input = window.prompt("Optional review message (leave blank for none):")
    if (input === null) return
    message = input
  }

  const num = getConversationNumber()
  if (!num) return

  try {
    await v3(`/repos/${location.pathname.split("/").slice(1, 3).join("/")}/pulls/${num}/reviews`, {
      method: "POST",
      body: JSON.stringify({ event: "APPROVE", body: message }),
      headers: { "Content-Type": "application/json" },
    })
    window.location.reload()
  } catch (err) {
    window.alert(`Approval failed: ${(err as Error).message}`)
  }
}

function addReviewerSidebarButtons(reviewersSection: Element): void {
  if (reviewersSection.querySelector(".rgh-quick-review")) return

  const reviewFilesPath = `${location.pathname}/files`
  const linkWrapper = el("span", { className: "text-normal color-fg-muted" })
  linkWrapper.append(" – ")

  const reviewLink = el("a", {
    href: reviewFilesPath,
    className: "rgh-quick-review btn-link Link--muted Link--inTextBlock",
  }, "review now")

  linkWrapper.append(reviewLink)
  reviewersSection.append(linkWrapper)

  // Only show "approve now" when: user is not the PR author, PR is open, user is logged in
  const viewer = getLoggedInUser()
  const author = getPrAuthor()
  if (!viewer || viewer === author) return
  if (document.querySelector(".State--merged, .State--closed")) return

  const approveBtn = el("button", {
    type: "button",
    className: "btn-link Link--muted Link--inTextBlock rgh-quick-approve",
  }, "approve now")

  approveBtn.title = "Hold Alt to approve without entering a message"
  approveBtn.addEventListener("click", approveNow)

  linkWrapper.append(" – ", approveBtn)
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Quick review",
  description:
    'Adds "review now" and "approve now" shortcuts to the PR sidebar so you can jump directly ' +
    'to the review dialog or approve without navigating away.',
  category: "write-actions",
  defaultEnabled: false,
  needsToken: false,
  isWrite: true,
  confirm: "Approve this pull request?",
  pageTest: (url) => isPR(url) || isPRFiles(url),
  init: (signal) => {
    // Sidebar Reviewers heading
    observe(
      "#reviewers-select-menu .discussion-sidebar-heading",
      addReviewerSidebarButtons,
      { signal }
    )
    // New React sidebar
    observe(
      '[data-testid="reviewers-section"] h3, [data-testid="reviewers-section"] .discussion-sidebar-heading',
      addReviewerSidebarButtons,
      { signal }
    )
    signal.addEventListener("abort", () => {
      document.querySelectorAll(".rgh-quick-review, .rgh-quick-approve").forEach((n) => n.closest("span")?.remove())
    }, { once: true })
  },
}

export default feature
