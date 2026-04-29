import { useEffect, useState } from "react"
import { InspectorPanel } from "../../components/InspectorPanel"
import type { ConsoleError } from "../../types"

export function InspectorSection() {
  const [consoleErrors, setConsoleErrors] = useState<ConsoleError[]>([])

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return
      chrome.runtime.sendMessage(
        { type: "GET_CONSOLE_ERRORS", tabId: tab.id },
        (result) => {
          if (result?.errors?.length) setConsoleErrors(result.errors)
        }
      )
    })()
  }, [])

  return (
    <InspectorPanel
      consoleErrors={consoleErrors}
      onClose={() => {}}
      onSendToChat={() => {}}
    />
  )
}
