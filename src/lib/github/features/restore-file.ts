// src/lib/github/features/restore-file.ts
// Ported from RGH restore-file.tsx
// Adds a "Discard changes" item in the PR file diff action menu.
// Uses v4 createCommitOnBranch mutation; requires token with repo scope.
import { observe } from "../observe"
import { isPRFiles } from "../page-detect"
import { parseRepo } from "../repo"
import { v3, v4, hasToken } from "../api"
import type { FeatureMeta } from "../registry"

const KEY = "restore-file"

// Get the merge base SHA for the PR
async function getMergeBaseSha(owner: string, repo: string, base: string, head: string): Promise<string> {
  const data = await v3<{ merge_base_commit: { sha: string } }>(
    `/repos/${owner}/${repo}/compare/${base}...${head}?cachebust=${Date.now()}`
  )
  return data.merge_base_commit.sha
}

// Get current head OID from the PR page meta (data-channel or similar) or from the
// commit statuses API.  RGH uses getPrInfo; we fall back to extracting from the DOM.
function getHeadOidFromDom(): string | null {
  const el = document.querySelector<HTMLElement>("[data-current-pull-request-head-oid]")
  if (el) return el.dataset.currentPullRequestHeadOid ?? null
  // New React view buries it in JSON-encoded props; attempt a simpler lookup
  const shaEl = document.querySelector<HTMLElement>(".commit-ref .css-truncate-target")
  return shaEl?.textContent?.trim() ?? null
}

async function discardFileChanges(filePath: string, newFilePath: string, commitTitle: string): Promise<void> {
  const info = parseRepo(new URL(location.href))
  if (!info) return

  // Parse branch names from PR URL: /owner/repo/pull/N
  const prMatch = location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!prMatch) return
  const [, owner, repo] = prMatch

  // Get base/head branch from the DOM
  const baseEl = document.querySelector<HTMLElement>(".base-ref")
  const headEl = document.querySelector<HTMLElement>(".head-ref")
  const base = baseEl?.textContent?.trim() ?? "main"
  const head = headEl?.textContent?.trim() ?? ""

  const [mergeBaseSha, headOid] = await Promise.all([
    getMergeBaseSha(owner, repo, base, head),
    Promise.resolve(getHeadOidFromDom()),
  ])

  if (!headOid) throw new Error("Could not determine head OID")

  // Get file at merge base (undefined = new file)
  let contents: string | undefined
  try {
    const fileResp = await v3<string>(
      `/repos/${owner}/${repo}/contents/${filePath}?ref=${mergeBaseSha}`,
      { headers: { Accept: "application/vnd.github.raw" }, responseFormat: "text" }
    )
    contents = fileResp
  } catch {
    contents = undefined
  }

  const isNewFile = contents === undefined
  const isRenamed = filePath !== newFilePath

  const additions = isNewFile ? [] : [{ path: filePath, contents: btoa(contents ?? "") }]
  const deletions = isRenamed || isNewFile ? [{ path: newFilePath }] : []

  await v4(
    `mutation discardChanges($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) { commit { oid } }
    }`,
    {
      input: {
        branch: { repositoryNameWithOwner: `${owner}/${repo}`, branchName: head },
        expectedHeadOid: headOid,
        fileChanges: { additions, deletions },
        message: { headline: commitTitle },
      },
    }
  )
}

function getFilenamesFromHeader(fileHeader: Element): { original: string; newName: string } | null {
  const nameEl = fileHeader.querySelector<HTMLElement>('[class^="DiffFileHeader-module__file-name"]')
  if (!nameEl) return null
  const span = nameEl.querySelector<HTMLElement>("span:not(.sr-only)")
  const text = (span ?? nameEl).textContent ?? ""
  const [original, renamed = original] = text.split("  ").map((s) => s.replace(/‎/g, "").trim())
  return { original, newName: renamed }
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Restore file",
  description:
    'Adds a "Discard changes" item in the PR file diff action menu. ' +
    'Commits a revert to the PR branch via the GitHub API.',
  category: "write-actions",
  defaultEnabled: false,
  needsToken: true,
  isWrite: true,
  writeScopes: ["repo"],
  confirm: "Discard all changes to this file? This will create a new commit on the PR branch.",
  pageTest: (url) => isPRFiles(url),
  init: (signal) => {
    // Inject "Discard changes" button into the React kebab menu when it opens
    observe(
      '[class^="DiffFileHeader-module__diff-file-header"] button:has(>.octicon-kebab-horizontal)',
      (menuButton) => {
        if (menuButton.classList.contains("rgh-restore-file-bound")) return
        menuButton.classList.add("rgh-restore-file-bound")

        menuButton.addEventListener(
          "click",
          () => {
            requestAnimationFrame(async () => {
              if (!await hasToken()) return
              const editItem = document.querySelector<HTMLElement>(
                '[class^="prc-ActionList-ActionListItem"]:has(.octicon-pencil)'
              )
              if (!editItem) return
              if (document.querySelector(".rgh-restore-file-item")) return

              const discardItem = editItem.cloneNode(true) as HTMLElement
              discardItem.classList.add("rgh-restore-file-item")
              const labelEl = discardItem.querySelector<HTMLElement>('[class^="prc-ActionList-ItemLabel"]')
              if (labelEl) labelEl.textContent = "Discard changes"
              const link = discardItem.querySelector("a")
              if (link) {
                link.removeAttribute("href")
                link.removeAttribute("aria-labelledby")
              }

              discardItem.addEventListener("click", async (e) => {
                e.preventDefault()
                e.stopPropagation()
                if (!window.confirm(feature.confirm!)) return

                // Find the file header
                const diffHeader = menuButton.closest<HTMLElement>('[class^="DiffFileHeader-module__diff-file-header"]')
                if (!diffHeader) return
                const filenames = getFilenamesFromHeader(diffHeader)
                if (!filenames) return

                const title = window.prompt(
                  "Enter a commit title for the discard:",
                  `Discard changes to ${filenames.original}`
                )
                if (!title) return

                try {
                  await discardFileChanges(filenames.original, filenames.newName, title)
                  diffHeader.closest<HTMLElement>("div[id^='diff-']")?.remove()
                  // Close the menu
                  document.querySelector<HTMLElement>("div[data-focus-trap='active']")?.remove()
                } catch (err) {
                  window.alert(`Failed to discard changes: ${(err as Error).message}`)
                }
              })

              editItem.after(discardItem)
            })
          },
          { signal }
        )
      },
      { signal }
    )
  },
}

export default feature
