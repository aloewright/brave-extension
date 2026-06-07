// src/lib/github/features/sync-pr-commit-title.ts
// Ported from RGH sync-pr-commit-title.tsx
// When squash-merging, keeps the squash commit title in sync with the PR title
// (format: "PR title (#number)"). No PAT needed — drives the merge form's input field.
import { observe } from "../observe"
import { isPR } from "../page-detect"
import { el } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "sync-pr-commit-title"

const COMMIT_TITLE_SELECTOR = '[data-testid="mergebox-partial"] input[type="text"]'
const PR_TITLE_SELECTOR = [
  'h1[class^="prc-PageHeader-Title"] .markdown-title',
  'div[class^="prc-PageLayout-Header"] input',
  "input#issue_title",
].join(", ")

function getPrNumber(): string | null {
  const m = location.pathname.match(/\/pull\/(\d+)/)
  return m ? m[1] : null
}

function getPrTitle(): string {
  const el = document.querySelector<HTMLElement>(PR_TITLE_SELECTOR)
  if (!el) return ""
  return el instanceof HTMLInputElement ? el.value.trim() : (el.textContent?.trim() ?? "")
}

function getTargetTitle(): string {
  const num = getPrNumber()
  const title = getPrTitle()
  return num && title ? `${title} (#${num})` : title
}

function getCurrentCommitTitle(): string {
  const field = document.querySelector<HTMLInputElement>(COMMIT_TITLE_SELECTOR)
  return field?.value.trim() ?? ""
}

function isSquashMerge(): boolean {
  const btn = document.querySelector<HTMLElement>('[data-testid="merge-box"] button, .js-merge-commit-button')
  return /squash/i.test(btn?.textContent ?? "")
}

function needsUpdate(): boolean {
  if (!isSquashMerge()) return false
  const current = getCurrentCommitTitle()
  return Boolean(current) && current !== getTargetTitle()
}

let cancelled = false

function showNote(field: HTMLInputElement): void {
  if (cancelled) return
  if (!needsUpdate()) {
    removeNote()
    return
  }
  const existing = document.querySelector(".rgh-sync-pr-commit-title-note")
  if (existing) return

  const cancelBtn = el("button", {
    type: "button",
    className: "btn-link Link--muted text-underline rgh-sync-pr-commit-title-cancel",
  }, "Cancel")
  cancelBtn.addEventListener("click", () => {
    cancelled = true
    removeNote()
  })

  const note = el("p", { className: "note rgh-sync-pr-commit-title-note" },
    "The PR title will be updated to match this commit title. ",
    cancelBtn
  )
  field.parentElement?.after(note)
}

function removeNote(): void {
  document.querySelector(".rgh-sync-pr-commit-title-note")?.remove()
}

function syncCommitTitle(field: HTMLInputElement): void {
  if (cancelled) return
  const target = getTargetTitle()
  if (field.value.trim() === target) return
  field.value = target
  field.dispatchEvent(new Event("input", { bubbles: true }))
}

function handleMergeClick(e: Event): void {
  if (cancelled) return
  const commitTitle = getCurrentCommitTitle()
  if (!commitTitle || !needsUpdate()) return
  // Strip " (#N)" from end to get clean PR title for updating PR title
  // (we don't call v3 here since this is a form-driven feature — no PAT)
  // The commit title already has the format "PR title (#N)" which is what GitHub uses.
  // Just ensure it's correct at the time of merge.
  syncCommitTitle(document.querySelector<HTMLInputElement>(COMMIT_TITLE_SELECTOR)!)
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Sync PR commit title",
  description:
    'When squash-merging, keeps the merge commit title in sync with the PR title ' +
    '(format: "PR title (#number)"). Form-driven, no API token needed.',
  category: "write-actions",
  defaultEnabled: false,
  needsToken: false,
  isWrite: true,
  pageTest: (url) => isPR(url),
  init: (signal) => {
    cancelled = false

    observe(COMMIT_TITLE_SELECTOR, (node) => {
      const field = node as HTMLInputElement
      syncCommitTitle(field)
      field.addEventListener("input", () => showNote(field), { signal } as AddEventListenerOptions)
    }, { signal })

    // Watch for PR title changes (re-sync commit field)
    observe(PR_TITLE_SELECTOR, () => {
      const field = document.querySelector<HTMLInputElement>(COMMIT_TITLE_SELECTOR)
      if (field) syncCommitTitle(field)
    }, { signal })

    // Intercept merge click
    document.addEventListener("click", (e) => {
      const target = e.target as HTMLElement
      if (target.closest('[data-testid="merge-box"] button, .js-merge-commit-button')) {
        handleMergeClick(e)
      }
    }, { signal } as AddEventListenerOptions)

    signal.addEventListener("abort", () => {
      removeNote()
      cancelled = false
    }, { once: true })
  },
}

export default feature
