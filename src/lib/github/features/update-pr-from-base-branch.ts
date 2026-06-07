// src/lib/github/features/update-pr-from-base-branch.ts
// Ported from RGH update-pr-from-base-branch.tsx + .gql + .css
// Adds "Update branch" (merge) and "Rebase" buttons on PRs that are behind their base.
// Uses v4 mutation updatePullRequestBranch. Requires repo scope token.
import { observe } from "../observe"
import { isPR } from "../page-detect"
import { v4, hasToken } from "../api"
import { el, injectStyle } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "update-pr-from-base-branch"
const GUARD = "rgh-update-pr-injected"

const CSS = `
section[aria-label='Conflicts']
  div[class^='MergeBoxSectionHeader-module__contentLayout']:has(> .rgh-update-pr-group) {
  > div[class^='prc-ButtonGroup'] {
    display: none;
  }
}
`

type UpdateMethod = "MERGE" | "REBASE"

async function getPrNodeId(): Promise<{ id: string; headRefOid: string } | null> {
  // Read from the DOM; GitHub embeds the PR node ID in a meta or data attribute
  const metaId = document.querySelector<HTMLMetaElement>('meta[name="octolytics-dimension-pull_request_id"]')
    ?.content
  // New React view: data-pull-node-id
  const domId = document.querySelector<HTMLElement>("[data-pull-node-id]")?.dataset.pullNodeId
  const id = domId ?? metaId ?? null
  const headOid =
    document.querySelector<HTMLElement>("[data-current-pull-request-head-oid]")?.dataset
      .currentPullRequestHeadOid ??
    document.querySelector<HTMLElement>(".commit-ref .css-truncate-target")?.textContent?.trim() ??
    null
  return id && headOid ? { id, headRefOid: headOid } : null
}

async function updateBranch(method: UpdateMethod): Promise<void> {
  const pr = await getPrNodeId()
  if (!pr) throw new Error("Could not determine PR ID")

  await v4(
    `mutation updatePullRequestBranch($input: UpdatePullRequestBranchInput!) {
      updatePullRequestBranch(input: $input) {
        clientMutationId
      }
    }`,
    { input: { expectedHeadOid: pr.headRefOid, pullRequestId: pr.id, updateMethod: method } }
  )
}

function disableButtons(container: Element, disabled: boolean): void {
  container.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
    b.disabled = disabled
  })
}

function createButtonGroup(): HTMLElement {
  const group = el("div", { className: `ButtonGroup rgh-update-pr-group` })

  for (const [method, label] of [
    ["MERGE", "Update branch"] as const,
    ["REBASE", "Rebase"] as const,
  ]) {
    const btn = el("button", {
      type: "button",
      className: "Button--secondary Button--medium Button rgh-update-pr-btn",
      dataset: { method },
    }, label)

    btn.addEventListener("click", async () => {
      if (btn.disabled) return
      if (!window.confirm(feature.confirm!)) return
      disableButtons(group, true)
      try {
        await updateBranch(method)
        window.location.reload()
      } catch (err) {
        window.alert(`Failed to update branch: ${(err as Error).message}`)
        disableButtons(group, false)
      }
    })

    group.append(el("div", {}, btn))
  }

  return group
}

async function handleStateIcon(stateIcon: Element): Promise<void> {
  const container = stateIcon
    .closest("section[aria-label='Conflicts']")
    ?.querySelector<HTMLElement>('div[class^="MergeBoxSectionHeader-module__contentLayout"]')
  if (!container) return

  const existingGroup = container.querySelector(".rgh-update-pr-group")

  if (stateIcon.querySelector(".octicon-check")) {
    // Branch is behind but not conflicted
    if (existingGroup) {
      disableButtons(existingGroup, false)
      return
    }
    // Don't inject twice
    if (container.dataset[GUARD]) return
    container.dataset[GUARD] = "1"

    const buttonGroup = createButtonGroup()
    container.append(buttonGroup)
    return
  }

  // Spinner → disable buttons while GitHub checks mergeability
  if (stateIcon.className.includes("Spinner") || stateIcon.className.includes("spinner")) {
    if (existingGroup) disableButtons(existingGroup, true)
    return
  }

  // Alert (conflict) → remove buttons
  if (stateIcon.querySelector(".octicon-alert-fill")) {
    existingGroup?.remove()
  }
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Update PR from base branch",
  description:
    'Adds "Update branch" (merge) and "Rebase" buttons on PRs that are behind their base branch, ' +
    'so you can update without leaving the page.',
  category: "write-actions",
  defaultEnabled: false,
  needsToken: true,
  isWrite: true,
  writeScopes: ["repo"],
  confirm: "Merge the base branch into this PR branch? This will create a new merge commit (or rebase) on the PR.",
  pageTest: (url) => isPR(url),
  init: async (signal) => {
    if (!await hasToken()) return
    injectStyle(KEY, CSS)

    observe(
      "section[aria-label='Conflicts'] .flex-shrink-0 > :first-child",
      (node) => { void handleStateIcon(node) },
      { signal }
    )

    signal.addEventListener("abort", () => {
      document.querySelectorAll(".rgh-update-pr-group").forEach((g) => g.remove())
    }, { once: true })
  },
}

export default feature
