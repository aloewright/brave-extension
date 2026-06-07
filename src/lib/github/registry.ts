// src/lib/github/registry.ts
import type { GitHubFeatureSettings } from "../../types"
import copyFilePath from "./features/copy-file-path"
import quickRepoDeletion from "./features/quick-repo-deletion"
import stickyFileHeaders from "./features/sticky-file-headers"
import usefulNotFoundPage from "./features/useful-not-found-page"

export type FeatureCategory =
  | "global" | "repository" | "pull-requests" | "issues" | "profiles" | "write-actions"

export interface FeatureMeta {
  id: string
  name: string
  description: string
  category: FeatureCategory
  defaultEnabled: boolean
  needsToken?: boolean
  isWrite?: boolean
  writeScopes?: string[]
  confirm?: string
  pageTest: (url: URL) => boolean
  init: (signal: AbortSignal) => void | Promise<void>
}

// Populated in Phase 5 as features are ported. Keep alphabetised by id.
export const FEATURES: FeatureMeta[] = [
  copyFilePath,
  quickRepoDeletion,
  stickyFileHeaders,
  usefulNotFoundPage,
]

export function featureMap(list: FeatureMeta[] = FEATURES): Record<string, FeatureMeta> {
  return Object.fromEntries(list.map((f) => [f.id, f]))
}

export function isFeatureOn(
  id: string,
  settings: GitHubFeatureSettings,
  registry: Record<string, FeatureMeta> = featureMap()
): boolean {
  if (!settings.enabled) return false
  return settings.features[id] ?? registry[id]?.defaultEnabled ?? false
}
