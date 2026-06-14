const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof Element ? target : null
  if (!element) return false
  const tag = element.tagName.toLowerCase()
  return tag === "input" || tag === "textarea" || tag === "select" || element.hasAttribute("contenteditable")
}

window.addEventListener(
  "keydown",
  (event) => {
    if (!event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey || event.key.toLowerCase() !== "a") {
      return
    }
    if (isEditableTarget(event.target)) return

    event.preventDefault()
    event.stopPropagation()

    const title = window.prompt("Save all tabs as:", `Tabs ${new Date().toLocaleString()}`)?.trim()
    if (!title) return

    void chrome.runtime.sendMessage({ type: "session/save-tabs-hotkey", title }).catch(() => undefined)
  },
  true
)
