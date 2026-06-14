import { applyAppearanceSettings } from "./appearance"
import { getSettings } from "../storage"

const SETTINGS_KEY = "ai-dev-settings"

void getSettings()
  .then((settings) => applyAppearanceSettings(settings))
  .catch(() => applyAppearanceSettings(null))

if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return
    applyAppearanceSettings(changes[SETTINGS_KEY].newValue)
  })
}
