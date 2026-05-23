import { useEffect, useState } from "react"
import type { ExtensionInfo } from "../types"

export function useExtensions() {
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([])
  const [loading, setLoading] = useState(true)

  const fetchExtensions = async () => {
    const all = await chrome.management.getAll()
    const exts = all
      .filter((e) => e.type === "extension" && e.id !== chrome.runtime.id)
      .map((e) => ({
        id: e.id,
        name: e.name,
        description: e.description || "",
        version: e.version,
        enabled: e.enabled,
        icons: e.icons,
        installType: e.installType,
        homepageUrl: e.homepageUrl,
        mayDisable: e.mayDisable,
        type: e.type
      }))
      .sort((a, b) => {
        if (a.enabled !== b.enabled) return a.enabled ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    setExtensions(exts)
    setLoading(false)
  }

  useEffect(() => {
    fetchExtensions()
    chrome.management.onEnabled.addListener(fetchExtensions)
    chrome.management.onDisabled.addListener(fetchExtensions)
    chrome.management.onInstalled.addListener(fetchExtensions)
    chrome.management.onUninstalled.addListener(fetchExtensions)
    return () => {
      chrome.management.onEnabled.removeListener(fetchExtensions)
      chrome.management.onDisabled.removeListener(fetchExtensions)
      chrome.management.onInstalled.removeListener(fetchExtensions)
      chrome.management.onUninstalled.removeListener(fetchExtensions)
    }
  }, [])

  const toggleExtension = async (id: string, enabled: boolean) => {
    await chrome.management.setEnabled(id, enabled)
  }

  const uninstallExtension = async (id: string) => {
    await chrome.management.uninstall(id)
  }

  const toggleAll = async (enabled: boolean, alwaysEnabled: string[] = []) => {
    const selfId = chrome.runtime.id
    const promises = extensions
      .filter((e) => e.id !== selfId && e.mayDisable && (enabled || !alwaysEnabled.includes(e.id)))
      .map((e) => chrome.management.setEnabled(e.id, enabled))
    await Promise.all(promises)
  }

  return { extensions, loading, toggleExtension, uninstallExtension, toggleAll, refresh: fetchExtensions }
}
