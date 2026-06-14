type MarkupTool = "highlight" | "box" | "note"

type StudioMessage =
  | { type: "PAGE_STUDIO_GET_SELECTION" }
  | {
      type: "PAGE_STUDIO_APPLY_TEXT"
      fontFamily: string
      color: string
      backgroundColor: string
      fontSize: string
      fontWeight: string
      letterSpacing: string
    }
  | { type: "PAGE_STUDIO_PICK_ELEMENT" }
  | {
      type: "PAGE_STUDIO_APPLY_ELEMENT_STYLE"
      color: string
      backgroundColor: string
      outlineColor: string
    }
  | { type: "PAGE_STUDIO_REMOVE_SELECTED" }
  | { type: "PAGE_STUDIO_START_MARKUP"; tool: MarkupTool; color: string; text: string }
  | { type: "PAGE_STUDIO_STOP_MARKUP" }
  | { type: "PAGE_STUDIO_CLEAR" }

type StyleSnapshot = Partial<Record<"color" | "backgroundColor" | "outline" | "outlineOffset" | "display", string>>

const TEXT_ATTR = "data-page-studio-text"
const MARK_ATTR = "data-page-studio-markup"
const SELECTED_ATTR = "data-page-studio-selected"

const changedElements = new Map<HTMLElement, StyleSnapshot>()
const textTargets = new Set<HTMLElement>()
const markupNodes = new Set<HTMLElement>()

let selectedElement: HTMLElement | null = null
let hoverBox: HTMLDivElement | null = null
let pickerActive = false
let markupTool: MarkupTool | null = null
let markupColor = "#ff6b35"
let markupText = "Rework this section"
let draftMark: HTMLDivElement | null = null
let markStart: { x: number; y: number } | null = null

function ok(payload: Record<string, unknown> = {}) {
  return { ok: true, ...payload }
}

function fail(error: string) {
  return { ok: false, error }
}

function selectionText() {
  return window.getSelection()?.toString() ?? ""
}

function rememberStyle(el: HTMLElement, props: Array<keyof StyleSnapshot>) {
  const snapshot = changedElements.get(el) ?? {}
  for (const prop of props) {
    if (!(prop in snapshot)) snapshot[prop] = el.style[prop] || ""
  }
  changedElements.set(el, snapshot)
}

function restoreChangedElements() {
  for (const [el, snapshot] of changedElements) {
    for (const [prop, value] of Object.entries(snapshot)) {
      ;(el.style as unknown as Record<string, string>)[prop] = value || ""
    }
    el.removeAttribute(SELECTED_ATTR)
  }
  changedElements.clear()
  selectedElement = null
}

function unwrapTextTargets() {
  for (const target of textTargets) {
    const parent = target.parentNode
    if (!parent) continue
    while (target.firstChild) parent.insertBefore(target.firstChild, target)
    parent.removeChild(target)
    parent.normalize()
  }
  textTargets.clear()
}

function clearMarkup() {
  for (const node of markupNodes) node.remove()
  markupNodes.clear()
  if (draftMark) draftMark.remove()
  draftMark = null
  markStart = null
  stopMarkup()
}

function clearAll() {
  unwrapTextTargets()
  restoreChangedElements()
  clearMarkup()
  removeHoverBox()
  pickerActive = false
}

function selectedElementLabel(el: HTMLElement | null) {
  if (!el) return ""
  const id = el.id ? `#${el.id}` : ""
  const klass = typeof el.className === "string" && el.className.trim()
    ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`
    : ""
  return `${el.tagName.toLowerCase()}${id}${klass}`
}

function applyTextStyles(target: HTMLElement, input: Extract<StudioMessage, { type: "PAGE_STUDIO_APPLY_TEXT" }>) {
  target.setAttribute(TEXT_ATTR, "true")
  target.style.fontFamily = input.fontFamily
  target.style.color = input.color
  target.style.backgroundColor = input.backgroundColor
  target.style.fontSize = input.fontSize
  target.style.fontWeight = input.fontWeight
  target.style.letterSpacing = input.letterSpacing
  target.style.borderRadius = "0.2em"
  target.style.boxDecorationBreak = "clone"
  ;(target.style as CSSStyleDeclaration & { webkitBoxDecorationBreak?: string }).webkitBoxDecorationBreak = "clone"
  target.style.padding = "0.02em 0.12em"
}

function wrapCurrentSelection(input: Extract<StudioMessage, { type: "PAGE_STUDIO_APPLY_TEXT" }>) {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const text = selection.toString()
  const range = selection.getRangeAt(0)
  const span = document.createElement("span")
  applyTextStyles(span, input)
  try {
    range.surroundContents(span)
  } catch {
    const contents = range.extractContents()
    span.appendChild(contents)
    range.insertNode(span)
  }
  selection.removeAllRanges()
  textTargets.add(span)
  return text
}

function updateHoverBox(el: Element) {
  if (!(el instanceof HTMLElement)) return
  if (!hoverBox) {
    hoverBox = document.createElement("div")
    hoverBox.style.position = "fixed"
    hoverBox.style.pointerEvents = "none"
    hoverBox.style.zIndex = "2147483646"
    hoverBox.style.border = "2px solid #ff6b35"
    hoverBox.style.background = "rgba(255, 107, 53, 0.08)"
    hoverBox.style.boxShadow = "0 0 0 1px rgba(255,255,255,0.65)"
    document.documentElement.appendChild(hoverBox)
  }
  const rect = el.getBoundingClientRect()
  hoverBox.style.left = `${rect.left}px`
  hoverBox.style.top = `${rect.top}px`
  hoverBox.style.width = `${rect.width}px`
  hoverBox.style.height = `${rect.height}px`
}

function removeHoverBox() {
  hoverBox?.remove()
  hoverBox = null
}

function onPickerMove(event: MouseEvent) {
  if (!pickerActive) return
  const target = event.target
  if (target instanceof HTMLElement) updateHoverBox(target)
}

function onPickerClick(event: MouseEvent) {
  if (!pickerActive) return
  event.preventDefault()
  event.stopPropagation()
  if (selectedElement) selectedElement.removeAttribute(SELECTED_ATTR)
  selectedElement = event.target instanceof HTMLElement ? event.target : null
  if (selectedElement) {
    rememberStyle(selectedElement, ["outline", "outlineOffset"])
    selectedElement.setAttribute(SELECTED_ATTR, "true")
    selectedElement.style.outline = "2px solid #ff6b35"
    selectedElement.style.outlineOffset = "2px"
  }
  pickerActive = false
  removeHoverBox()
  document.removeEventListener("mousemove", onPickerMove, true)
  document.removeEventListener("click", onPickerClick, true)
}

function startPicker() {
  pickerActive = true
  document.addEventListener("mousemove", onPickerMove, true)
  document.addEventListener("click", onPickerClick, true)
}

function makeMarkBase() {
  const node = document.createElement("div")
  node.setAttribute(MARK_ATTR, "true")
  node.style.position = "fixed"
  node.style.zIndex = "2147483645"
  node.style.pointerEvents = "none"
  document.documentElement.appendChild(node)
  markupNodes.add(node)
  return node
}

function styleRectMark(node: HTMLElement, x: number, y: number, width: number, height: number) {
  node.style.left = `${x}px`
  node.style.top = `${y}px`
  node.style.width = `${width}px`
  node.style.height = `${height}px`
  node.style.borderRadius = markupTool === "highlight" ? "8px" : "3px"
  node.style.border = markupTool === "box" ? `3px solid ${markupColor}` : `2px solid ${markupColor}`
  node.style.background = markupTool === "highlight" ? `${markupColor}44` : `${markupColor}12`
  node.style.boxShadow = `0 0 0 1px rgba(255,255,255,0.75), 0 10px 28px ${markupColor}22`
}

function onMarkupPointerDown(event: PointerEvent) {
  if (!markupTool) return
  event.preventDefault()
  event.stopPropagation()
  if (markupTool === "note") {
    const note = makeMarkBase()
    note.textContent = markupText || "Note"
    note.style.left = `${event.clientX}px`
    note.style.top = `${event.clientY}px`
    note.style.maxWidth = "260px"
    note.style.padding = "8px 10px"
    note.style.borderRadius = "10px"
    note.style.color = "#111827"
    note.style.background = markupColor
    note.style.font = "600 13px/1.35 ui-sans-serif, system-ui, sans-serif"
    note.style.boxShadow = "0 14px 36px rgba(0,0,0,0.24)"
    return
  }
  markStart = { x: event.clientX, y: event.clientY }
  draftMark = makeMarkBase()
  styleRectMark(draftMark, event.clientX, event.clientY, 1, 1)
}

function onMarkupPointerMove(event: PointerEvent) {
  if (!markupTool || !markStart || !draftMark) return
  event.preventDefault()
  const x = Math.min(markStart.x, event.clientX)
  const y = Math.min(markStart.y, event.clientY)
  const width = Math.abs(event.clientX - markStart.x)
  const height = Math.abs(event.clientY - markStart.y)
  styleRectMark(draftMark, x, y, width, height)
}

function onMarkupPointerUp(event: PointerEvent) {
  if (!markupTool || !draftMark) return
  event.preventDefault()
  markStart = null
  draftMark = null
}

function startMarkup(input: Extract<StudioMessage, { type: "PAGE_STUDIO_START_MARKUP" }>) {
  stopMarkup()
  markupTool = input.tool
  markupColor = input.color
  markupText = input.text
  document.addEventListener("pointerdown", onMarkupPointerDown, true)
  document.addEventListener("pointermove", onMarkupPointerMove, true)
  document.addEventListener("pointerup", onMarkupPointerUp, true)
}

function stopMarkup() {
  markupTool = null
  document.removeEventListener("pointerdown", onMarkupPointerDown, true)
  document.removeEventListener("pointermove", onMarkupPointerMove, true)
  document.removeEventListener("pointerup", onMarkupPointerUp, true)
}

chrome.runtime.onMessage.addListener((message: StudioMessage, _sender, sendResponse) => {
  try {
    if (message.type === "PAGE_STUDIO_GET_SELECTION") {
      sendResponse(ok({ text: selectionText() }))
      return true
    }

    if (message.type === "PAGE_STUDIO_APPLY_TEXT") {
      const text = wrapCurrentSelection(message)
      if (!text && textTargets.size === 0) {
        sendResponse(fail("Highlight text on the page first, then apply typography."))
        return true
      }
      if (!text) {
        for (const target of textTargets) applyTextStyles(target, message)
      }
      sendResponse(ok({ text: text || selectionText(), count: textTargets.size }))
      return true
    }

    if (message.type === "PAGE_STUDIO_PICK_ELEMENT") {
      startPicker()
      sendResponse(ok())
      return true
    }

    if (message.type === "PAGE_STUDIO_APPLY_ELEMENT_STYLE") {
      if (!selectedElement) {
        sendResponse(fail("Pick an element on the page first."))
        return true
      }
      rememberStyle(selectedElement, ["color", "backgroundColor", "outline", "outlineOffset"])
      selectedElement.style.color = message.color
      selectedElement.style.backgroundColor = message.backgroundColor
      selectedElement.style.outline = `2px solid ${message.outlineColor}`
      selectedElement.style.outlineOffset = "2px"
      sendResponse(ok({ tagName: selectedElement.tagName.toLowerCase(), label: selectedElementLabel(selectedElement) }))
      return true
    }

    if (message.type === "PAGE_STUDIO_REMOVE_SELECTED") {
      if (!selectedElement) {
        sendResponse(fail("Pick an element on the page first."))
        return true
      }
      rememberStyle(selectedElement, ["display"])
      selectedElement.style.display = "none"
      sendResponse(ok({ tagName: selectedElement.tagName.toLowerCase(), label: selectedElementLabel(selectedElement) }))
      return true
    }

    if (message.type === "PAGE_STUDIO_START_MARKUP") {
      startMarkup(message)
      sendResponse(ok())
      return true
    }

    if (message.type === "PAGE_STUDIO_STOP_MARKUP") {
      stopMarkup()
      sendResponse(ok())
      return true
    }

    if (message.type === "PAGE_STUDIO_CLEAR") {
      clearAll()
      sendResponse(ok())
      return true
    }

    sendResponse(fail("Unknown Page Studio command."))
    return true
  } catch (err) {
    sendResponse(fail(err instanceof Error ? err.message : String(err)))
    return true
  }
})
