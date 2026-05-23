export interface FontStyle {
  family: string
  size: string
  weight: string
  lineHeight: string
  letterSpacing: string
  style: string
}

export function fontFromComputed(c: CSSStyleDeclaration | Record<string, string>): FontStyle {
  const get = (k: string) => (typeof (c as CSSStyleDeclaration).getPropertyValue === "function"
    ? (c as CSSStyleDeclaration).getPropertyValue(k)
    : (c as Record<string, string>)[k]) ?? ""
  return {
    family: get("font-family"),
    size: get("font-size"),
    weight: get("font-weight"),
    lineHeight: get("line-height"),
    letterSpacing: get("letter-spacing"),
    style: get("font-style")
  }
}

export function primaryFamily(family: string): string {
  if (!family) return ""
  const first = family.split(",")[0]
  return first.trim().replace(/^['"]|['"]$/g, "")
}
