// src/lib/github/features/useful-not-found-page.ts
// On a GitHub 404 page, inject breadcrumb links that walk up the URL path
// segment by segment plus a search link, helping users navigate to a valid
// ancestor. DOM-based, idempotent (guarded by data-rgh-nfp).
import { el } from "../dom"
import type { FeatureMeta } from "../registry"

const GUARD = "data-rgh-nfp"

/** Detect a GitHub 404 page defensively. */
function is404(): boolean {
  // GitHub sets the page title to "Page not found" on 404s
  if (document.title.startsWith("Page not found")) return true
  // Older GitHub pages use #parallax_error
  if (document.getElementById("parallax_error")) return true
  // Some pages use data-error attribute on main
  const main = document.querySelector("main")
  if (main?.dataset.error === "404") return true
  return false
}

/** Build ancestor path links from the current pathname. */
function buildBreadcrumbs(): HTMLElement[] {
  const segments = location.pathname.split("/").filter(Boolean)
  const links: HTMLElement[] = []

  // Walk from root down, building cumulative paths.
  // Skip the very last segment — it's the 404'd resource itself.
  for (let i = 0; i < segments.length - 1; i++) {
    if (i > 0) {
      links.push(document.createTextNode(" / ") as unknown as HTMLElement)
    }
    const href = "/" + segments.slice(0, i + 1).join("/")
    links.push(el("a", { href }, segments[i]))
  }

  // Strike through the final (404) segment
  const del = document.createElement("del")
  del.className = "color-fg-subtle"
  if (links.length > 0) {
    links.push(document.createTextNode(" / ") as unknown as HTMLElement)
  }
  del.textContent = segments[segments.length - 1] ?? ""
  links.push(del)

  return links
}

function init(signal: AbortSignal): void {
  if (signal.aborted) return
  if (!is404()) return

  const segments = location.pathname.split("/").filter(Boolean)
  if (segments.length < 2) return

  // Guard idempotency
  if (document.querySelector(`[${GUARD}]`)) return

  // Find a suitable insertion point
  const anchor =
    document.querySelector("main > :first-child") ??
    document.getElementById("parallax_illustration") ??
    document.querySelector("main")
  if (!anchor) return

  // Build breadcrumb container
  const crumbs = buildBreadcrumbs()
  const h2 = el("h2", { className: "container mt-4 text-center" })
  h2.setAttribute(GUARD, "1")
  for (const node of crumbs) {
    h2.append(node instanceof Node ? node : document.createTextNode(String(node)))
  }

  anchor.after(h2)

  // Add a repo search link when on a repo path
  if (segments.length >= 1) {
    const owner = segments[0]
    const searchHref = `https://github.com/search?q=${encodeURIComponent(owner)}&type=repositories`
    const p = el(
      "p",
      { className: "container mt-2 text-center" },
      el("a", { href: searchHref }, `Search repositories in @${owner}`)
    )
    h2.after(p)
  }

  signal.addEventListener("abort", () => {
    document.querySelector(`[${GUARD}]`)?.remove()
    // Remove the search link too (it's the next sibling)
  }, { once: true })
}

const feature: FeatureMeta = {
  id: "useful-not-found-page",
  name: "Useful not-found page",
  description: "On 404 pages, add ancestor path links and a search link to help navigate to existing content.",
  category: "global",
  defaultEnabled: true,
  pageTest: (_url: URL) => true, // init no-ops when no 404 marker present
  init
}

export default feature
