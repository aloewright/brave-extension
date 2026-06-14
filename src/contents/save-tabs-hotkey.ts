const isEditableTarget = (target: EventTarget | null): boolean => {
  const element = target instanceof Element ? target : null
  if (!element) return false
  const tag = element.tagName.toLowerCase()
  return tag === "input" || tag === "textarea" || tag === "select" || element.hasAttribute("contenteditable")
}

const sendShortcutMessage = (type: string) => {
  void chrome.runtime
    .sendMessage({
      type,
      url: window.location.href,
      title: document.title || window.location.href,
      contentType: document.contentType
    })
    .catch(() => undefined)
}

window.addEventListener(
  "keydown",
  (event) => {
    if (!event.metaKey || !event.shiftKey || event.altKey || event.ctrlKey) {
      return
    }
    if (isEditableTarget(event.target)) return

    const key = event.key.toLowerCase()
    if (key === "y") {
      event.preventDefault()
      event.stopPropagation()
      sendShortcutMessage("session/save-page-link-hotkey")
      return
    }

    if (key === "u") {
      event.preventDefault()
      event.stopPropagation()
      sendShortcutMessage("session/save-pdf-hotkey")
      return
    }

    if (key !== "a") return

    event.preventDefault()
    event.stopPropagation()

    const title = window.prompt("Save all tabs as:", `Tabs ${new Date().toLocaleString()}`)?.trim()
    if (!title) return

    void chrome.runtime.sendMessage({ type: "session/save-tabs-hotkey", title }).catch(() => undefined)
  },
  true
)
