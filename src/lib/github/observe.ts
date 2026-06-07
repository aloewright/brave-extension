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

export function elementReady(
  selector: string,
  { timeout = 10_000, signal }: { timeout?: number; signal?: AbortSignal } = {}
): Promise<Element | null> {
  const existing = document.querySelector(selector)
  if (existing) return Promise.resolve(existing)
  if (signal?.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout>
    const finish = (value: Element | null) => {
      mo.disconnect()
      clearTimeout(timer)
      signal?.removeEventListener("abort", onAbort)
      resolve(value)
    }
    const onAbort = () => finish(null)
    const mo = new MutationObserver(() => {
      const found = document.querySelector(selector)
      if (found) finish(found)
    })
    signal?.addEventListener("abort", onAbort, { once: true })
    mo.observe(document.documentElement, { childList: true, subtree: true })
    timer = setTimeout(() => finish(document.querySelector(selector)), timeout)
  })
}
