const PROCESSED = new WeakSet<Element>()

interface ObserveOptions { signal: AbortSignal }

/**
 * Run `cb` for every element matching `selector` that currently exists or
 * appears later, exactly once per element. Stops on signal abort.
 */
export function observe(
  selector: string,
  cb: (element: Element) => void,
  { signal }: ObserveOptions
): void {
  const seen = new WeakSet<Element>()
  const run = (root: ParentNode) => {
    for (const node of root.querySelectorAll(selector)) {
      if (seen.has(node)) continue
      seen.add(node)
      cb(node)
    }
  }
  run(document)
  const mo = new MutationObserver((records) => {
    for (const record of records) {
      for (const added of record.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue
        const element = added as Element
        if (element.matches(selector) && !seen.has(element)) {
          seen.add(element)
          cb(element)
        }
        run(element)
      }
    }
  })
  mo.observe(document.documentElement, { childList: true, subtree: true })
  signal.addEventListener("abort", () => mo.disconnect(), { once: true })
}

export { PROCESSED }

export function elementReady(
  selector: string,
  { timeout = 10_000 }: { timeout?: number } = {}
): Promise<Element | null> {
  const existing = document.querySelector(selector)
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const mo = new MutationObserver(() => {
      const found = document.querySelector(selector)
      if (found) { mo.disconnect(); resolve(found) }
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    setTimeout(() => { mo.disconnect(); resolve(document.querySelector(selector)) }, timeout)
  })
}
