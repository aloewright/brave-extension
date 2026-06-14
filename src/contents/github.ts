// src/contents/github.ts
import type { GitHubFeatureSettings } from "../types"
import { FEATURES } from "../lib/github/registry"
import { createRuntime } from "../lib/github/runtime"

const SETTINGS_KEY = "ai-dev-settings"
const DEFAULT_GH: GitHubFeatureSettings = { enabled: true, features: {} }

async function readGitHubSettings(): Promise<GitHubFeatureSettings> {
  const res = await chrome.storage.local.get(SETTINGS_KEY)
  const settings = (res[SETTINGS_KEY] || {}) as { github?: GitHubFeatureSettings }
  return settings.github ?? DEFAULT_GH
}

async function main(): Promise<void> {
  const runtime = createRuntime(FEATURES)
  await runtime.start(await readGitHubSettings())
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SETTINGS_KEY]) return
    const next = (changes[SETTINGS_KEY].newValue || {}) as { github?: GitHubFeatureSettings }
    void runtime.apply(next.github ?? DEFAULT_GH)
  })
}

void main()
