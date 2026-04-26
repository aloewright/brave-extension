import type { ElementSnapshot } from "../types"

import { parseColor, toHex } from "./color"

const DEFAULTS: Record<string, string> = {
  "margin-top": "0px",
  "margin-right": "0px",
  "margin-bottom": "0px",
  "margin-left": "0px",
  "padding-top": "0px",
  "padding-right": "0px",
  "padding-bottom": "0px",
  "padding-left": "0px",
  "border-top-width": "0px",
  "border-right-width": "0px",
  "border-bottom-width": "0px",
  "border-left-width": "0px",
  "border-top-style": "none",
  "border-right-style": "none",
  "border-bottom-style": "none",
  "border-left-style": "none",
  "border-radius": "0px",
  "border-top-left-radius": "0px",
  "border-top-right-radius": "0px",
  "border-bottom-left-radius": "0px",
  "border-bottom-right-radius": "0px",
  display: "block",
  position: "static",
  "z-index": "auto",
  opacity: "1",
  visibility: "visible",
  "font-weight": "400",
  "font-style": "normal",
  "letter-spacing": "normal",
  "text-align": "start",
  "text-decoration-line": "none",
  "text-transform": "none",
  "white-space": "normal",
  "line-height": "normal",
  "background-color": "rgba(0, 0, 0, 0)",
  "background-image": "none",
  "box-shadow": "none",
  "transform": "none",
  "filter": "none",
  "overflow-x": "visible",
  "overflow-y": "visible",
  "flex-direction": "row",
  "flex-wrap": "nowrap",
  "justify-content": "normal",
  "align-items": "normal",
  "gap": "normal"
}

const INTERESTING_PROPERTIES = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "color",
  "background-color",
  "background-image",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-color",
  "border-top-style",
  "border-radius",
  "box-shadow",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-decoration-line",
  "text-transform",
  "opacity",
  "transform",
  "filter",
  "overflow-x",
  "overflow-y",
  "flex-direction",
  "flex-wrap",
  "justify-content",
  "align-items",
  "gap"
]

export function generateHtml(snapshot: ElementSnapshot): string {
  return snapshot.outerHTML
    .replace(/\s+data-alexometer="[^"]*"/g, "")
    .replace(/\s+data-alexometer-overlay="[^"]*"/g, "")
}

export function generateCss(snapshot: ElementSnapshot): string {
  const decls: string[] = []
  for (const prop of INTERESTING_PROPERTIES) {
    const value = snapshot.computed[prop]
    if (value === undefined || value === "" || value === DEFAULTS[prop]) continue
    decls.push(`  ${prop}: ${value};`)
  }
  const sel = snapshot.selector || snapshot.tagName.toLowerCase()
  return `${sel} {\n${decls.join("\n")}\n}`
}

export function generateTailwind(snapshot: ElementSnapshot): string {
  const c = snapshot.computed
  const cls: string[] = []

  const display = c["display"]
  if (display === "flex") cls.push("flex")
  else if (display === "inline-flex") cls.push("inline-flex")
  else if (display === "grid") cls.push("grid")
  else if (display === "inline-block") cls.push("inline-block")
  else if (display === "block") {
    /* default */
  } else if (display === "none") cls.push("hidden")

  if (c["flex-direction"] === "column") cls.push("flex-col")
  if (c["flex-direction"] === "row-reverse") cls.push("flex-row-reverse")
  if (c["flex-wrap"] === "wrap") cls.push("flex-wrap")

  cls.push(...justifyClass(c["justify-content"]))
  cls.push(...alignClass(c["align-items"]))

  cls.push(...spacingClass("p", c["padding-top"], c["padding-right"], c["padding-bottom"], c["padding-left"]))
  cls.push(...spacingClass("m", c["margin-top"], c["margin-right"], c["margin-bottom"], c["margin-left"]))

  if (c["gap"] && c["gap"] !== "normal" && c["gap"] !== "0px") cls.push(`gap-[${c["gap"]}]`)

  const fg = c["color"]
  if (fg) {
    const parsed = parseColor(fg)
    if (parsed && parsed.a > 0) cls.push(`text-[${toHex(parsed)}]`)
  }
  const bg = c["background-color"]
  if (bg) {
    const parsed = parseColor(bg)
    if (parsed && parsed.a > 0) cls.push(`bg-[${toHex(parsed)}]`)
  }

  if (c["font-size"]) cls.push(`text-[${c["font-size"]}]`)
  cls.push(...fontWeightClass(c["font-weight"]))
  if (c["font-style"] === "italic") cls.push("italic")
  if (c["text-align"] && c["text-align"] !== "start") cls.push(`text-${c["text-align"]}`)
  if (c["text-transform"] === "uppercase") cls.push("uppercase")
  if (c["text-transform"] === "lowercase") cls.push("lowercase")
  if (c["text-transform"] === "capitalize") cls.push("capitalize")
  if (c["line-height"] && c["line-height"] !== "normal") cls.push(`leading-[${c["line-height"]}]`)
  if (c["letter-spacing"] && c["letter-spacing"] !== "normal") cls.push(`tracking-[${c["letter-spacing"]}]`)

  if (c["border-radius"] && c["border-radius"] !== "0px") cls.push(`rounded-[${c["border-radius"]}]`)
  const bw = c["border-top-width"]
  if (bw && bw !== "0px") cls.push(`border-[${bw}]`)
  const bc = c["border-top-color"]
  if (bc) {
    const parsed = parseColor(bc)
    if (parsed && parsed.a > 0) cls.push(`border-[${toHex(parsed)}]`)
  }

  if (c["opacity"] && c["opacity"] !== "1") cls.push(`opacity-[${c["opacity"]}]`)
  if (c["box-shadow"] && c["box-shadow"] !== "none") cls.push(`shadow-[${c["box-shadow"]}]`)

  return cls.filter(Boolean).join(" ")
}

function spacingClass(prefix: "p" | "m", t?: string, r?: string, b?: string, l?: string): string[] {
  if (!t && !r && !b && !l) return []
  const norm = (v?: string) => (v === "0px" || v === undefined ? "0" : v)
  const T = norm(t)
  const R = norm(r)
  const B = norm(b)
  const L = norm(l)
  if (T === R && R === B && B === L) {
    return T === "0" ? [] : [`${prefix}-[${T}]`]
  }
  if (T === B && L === R) {
    const out: string[] = []
    if (T !== "0") out.push(`${prefix}y-[${T}]`)
    if (L !== "0") out.push(`${prefix}x-[${L}]`)
    return out
  }
  const out: string[] = []
  if (T !== "0") out.push(`${prefix}t-[${T}]`)
  if (R !== "0") out.push(`${prefix}r-[${R}]`)
  if (B !== "0") out.push(`${prefix}b-[${B}]`)
  if (L !== "0") out.push(`${prefix}l-[${L}]`)
  return out
}

function justifyClass(v?: string): string[] {
  if (!v) return []
  const map: Record<string, string> = {
    "flex-start": "justify-start",
    "flex-end": "justify-end",
    center: "justify-center",
    "space-between": "justify-between",
    "space-around": "justify-around",
    "space-evenly": "justify-evenly"
  }
  return map[v] ? [map[v]] : []
}

function alignClass(v?: string): string[] {
  if (!v) return []
  const map: Record<string, string> = {
    "flex-start": "items-start",
    "flex-end": "items-end",
    center: "items-center",
    baseline: "items-baseline",
    stretch: "items-stretch"
  }
  return map[v] ? [map[v]] : []
}

function fontWeightClass(v?: string): string[] {
  if (!v) return []
  const map: Record<string, string> = {
    "100": "font-thin",
    "200": "font-extralight",
    "300": "font-light",
    "400": "font-normal",
    "500": "font-medium",
    "600": "font-semibold",
    "700": "font-bold",
    "800": "font-extrabold",
    "900": "font-black"
  }
  if (map[v]) return v === "400" ? [] : [map[v]]
  return []
}
