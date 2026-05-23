import { useState, useEffect, useCallback } from "react"
import { getSettings, setSettings as saveSettings } from "../storage"
import type { Settings } from "../types"

export function useSettings() {
  const [settings, setLocal] = useState<Settings | null>(null)

  useEffect(() => {
    getSettings().then(setLocal)
  }, [])

  const update = useCallback(async (partial: Partial<Settings>) => {
    await saveSettings(partial)
    const next = await getSettings()
    setLocal(next)
  }, [])

  return { settings, update }
}
