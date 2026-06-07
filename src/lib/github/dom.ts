// Safe DOM construction. No innerHTML, no eval. Replaces dom-chef for our needs.

type Props = {
  className?: string
  title?: string
  href?: string
  type?: string
  ariaLabel?: string
  dataset?: Record<string, string>
  onclick?: (event: MouseEvent) => void
}

type Child = Node | string | null | undefined | false

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (props.className) node.className = props.className
  if (props.title) node.title = props.title
  if (props.type) node.setAttribute("type", props.type)
  if (props.ariaLabel) node.setAttribute("aria-label", props.ariaLabel)
  if (props.href && "href" in node) (node as unknown as HTMLAnchorElement).href = props.href
  if (props.dataset) for (const [k, v] of Object.entries(props.dataset)) node.dataset[k] = v
  if (props.onclick) node.addEventListener("click", props.onclick as EventListener)
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

/** Idempotently inject a keyed <style>. Returns the element. */
export function injectStyle(key: string, css: string): HTMLStyleElement {
  const existing = document.querySelector<HTMLStyleElement>(`style[data-rgh='${CSS.escape(key)}']`)
  if (existing) return existing
  const style = document.createElement("style")
  style.dataset.rgh = key
  style.textContent = css
  document.head.append(style)
  return style
}

export function removeStyle(key: string): void {
  document.querySelector(`style[data-rgh='${CSS.escape(key)}']`)?.remove()
}
