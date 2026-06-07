// src/lib/github/features/quick-label-removal.ts
// Ported from RGH quick-label-removal.tsx + .css
// Appends a small × button to each label on issues/PRs so you can remove it in one click.
// Uses v3 DELETE /repos/{owner}/{repo}/issues/{number}/labels/{name}.
import { observe } from "../observe"
import { isIssue, isPR } from "../page-detect"
import { parseRepo } from "../repo"
import { v3, hasToken } from "../api"
import { el, injectStyle } from "../dom"
import type { FeatureMeta } from "../registry"

const KEY = "quick-label-removal"

const CSS = `
.rgh-quick-label-removal {
  display: inline-flex !important;
  margin-left: 2px;
  margin-right: -7px;
  color: inherit !important;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  align-items: center;
}
.rgh-quick-label-removal svg {
  margin: 2px;
  margin-left: 0;
  border-radius: 50%;
  padding: 2px 0;
  width: 14px;
  height: 14px;
}
.rgh-quick-label-removal:is(:focus, :hover) svg {
  background-color: currentcolor;
  fill: rgb(var(--label-r) var(--label-g) var(--label-b));
}
`

function getConversationNumber(): string | null {
  const m = location.pathname.match(/\/(issues|pull)\/(\d+)/)
  return m ? m[2] : null
}

async function removeLabel(labelName: string, labelElement: HTMLElement): Promise<void> {
  const info = parseRepo(new URL(location.href))
  if (!info) return
  const num = getConversationNumber()
  if (!num) return

  labelElement.hidden = true
  try {
    await v3(`/repos/${info.owner}/${info.name}/issues/${num}/labels/${encodeURIComponent(labelName)}`, {
      method: "DELETE",
    })
    labelElement.remove()
  } catch {
    labelElement.hidden = false
    window.alert(`Failed to remove label "${labelName}"`)
  }
}

function addRemoveButton(label: Element): void {
  if (label.querySelector(".rgh-quick-label-removal")) return

  const labelName =
    (label as HTMLElement).dataset.name ??
    label.querySelector<HTMLElement>("[data-name]")?.dataset.name ??
    label.textContent?.trim() ??
    ""

  if (!labelName) return

  const svgNS = "http://www.w3.org/2000/svg"
  const svg = document.createElementNS(svgNS, "svg")
  svg.setAttribute("viewBox", "0 0 16 16")
  svg.setAttribute("width", "14")
  svg.setAttribute("height", "14")
  const path = document.createElementNS(svgNS, "path")
  path.setAttribute(
    "d",
    "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"
  )
  svg.append(path)

  const btn = el("button", {
    type: "button",
    className: "rgh-quick-label-removal",
    ariaLabel: `Remove label ${labelName}`,
    onclick: (e) => {
      e.preventDefault()
      e.stopPropagation()
      void removeLabel(labelName, label as HTMLElement)
    },
  })
  btn.append(svg)

  ;(label as HTMLElement).style.display = "inline-flex"
  ;(label as HTMLElement).style.alignItems = "center"
  label.append(btn)
}

const feature: FeatureMeta = {
  id: KEY,
  name: "Quick label removal",
  description:
    "Adds an × button to each label on issues and PRs so you can remove it without opening the label picker.",
  category: "write-actions",
  defaultEnabled: false,
  needsToken: true,
  isWrite: true,
  writeScopes: ["repo"],
  pageTest: (url) => isIssue(url) || isPR(url),
  init: async (signal) => {
    if (!await hasToken()) return
    injectStyle(KEY, CSS)
    // Labels in the sidebar: .js-issue-labels .IssueLabel  (legacy selectors still present)
    observe(".js-issue-labels .IssueLabel", addRemoveButton, { signal })
    // New React sidebar labels
    observe('[data-testid="labels-section-list"] a', addRemoveButton, { signal })
    signal.addEventListener("abort", () => {
      document.querySelectorAll(".rgh-quick-label-removal").forEach((b) => b.remove())
    }, { once: true })
  },
}

export default feature
