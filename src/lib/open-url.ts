import type { MouseEvent } from "react"

export async function openExternalUrl(url: string): Promise<void> {
  if (!url) return
  if (typeof chrome !== "undefined" && chrome.tabs?.create) {
    await chrome.tabs.create({ url, active: true })
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}

export function openExternalLink(url: string) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    openExternalUrl(url).catch(() => {
      window.open(url, "_blank", "noopener,noreferrer")
    })
  }
}
