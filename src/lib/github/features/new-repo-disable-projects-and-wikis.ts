// src/lib/github/features/new-repo-disable-projects-and-wikis.ts
// Ported from RGH new-repo-disable-projects-and-wikis.tsx
// On the /new repo page: injects a checkbox. After repo creation, patches the new repo
// via v3 PATCH /repos/{o}/{r} to set has_projects=false and has_wiki=false.
import { observe } from "../observe"
import { isNewRepo } from "../page-detect"
import { v3, hasToken } from "../api"
import { el } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "new-repo-disable-projects-and-wikis"
const SESSION_KEY = "rghNewRepo"
const GUARD = "rgh-disable-projects-wikis-added"

function getCheckbox(): HTMLInputElement | null {
  return document.querySelector<HTMLInputElement>("#rgh-disable-projects-wikis")
}

function isChecked(): boolean {
  return getCheckbox()?.checked ?? false
}

async function disableAfterCreate(): Promise<void> {
  sessionStorage.removeItem(SESSION_KEY)
  const m = location.pathname.match(/^\/([^/]+)\/([^/]+)/)
  if (!m) return
  const [, owner, repo] = m
  await v3(`/repos/${owner}/${repo}`, {
    method: "PATCH",
    body: JSON.stringify({ has_projects: false, has_wiki: false }),
    headers: { "Content-Type": "application/json" },
  })
  // Remove nav tabs for Projects and Wiki
  document.querySelectorAll<HTMLElement>(
    'li:has([data-content="Wiki"]), li:has([data-content="Projects"]), [data-menu-item$="wiki-tab"], [data-menu-item$="projects-tab"]'
  ).forEach((el) => el.remove())
}

function injectCheckboxOld(submitButton: HTMLElement): void {
  if (submitButton.closest("form")?.querySelector("#rgh-disable-projects-wikis")) return
  if (submitButton.closest("form")?.dataset[GUARD]) return

  const wrapper = el("div", { className: "flash flash-warn py-0 ml-n3 my-4" })
  const label = el("label")
  const cb = el("input", { type: "checkbox", className: "" }) as HTMLInputElement
  cb.id = "rgh-disable-projects-wikis"
  cb.checked = true
  label.append(cb, " Disable Projects and Wikis")
  wrapper.append(label)
  submitButton.parentElement!.before(wrapper)
  submitButton.parentElement!.closest("form")!.dataset[GUARD] = "1"
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Disable projects and wikis on new repos",
  description:
    "Adds a checkbox on /new. After creation, patches the repo to disable Projects and Wiki tabs.",
  category: "write-actions",
  defaultEnabled: false,
  needsToken: true,
  isWrite: true,
  writeScopes: ["repo"],
  pageTest: (url) => isNewRepo(url) || (typeof sessionStorage !== "undefined" && Boolean(sessionStorage.getItem(SESSION_KEY))),
  init: async (signal) => {
    if (!await hasToken()) return

    // Check if we've just landed on the newly created repo page
    if (sessionStorage.getItem(SESSION_KEY)) {
      await disableAfterCreate()
      return
    }

    // Old /new form: observe submit button
    observe('form:has(.octicon-info) [type=submit], form [type=submit].btn-primary', injectCheckboxOld, { signal })

    // Set session flag when the form submits and checkbox is checked
    document.addEventListener("submit", () => {
      if (isChecked()) sessionStorage.setItem(SESSION_KEY, "1")
    }, { signal } as AddEventListenerOptions)
  },
}

export default feature
