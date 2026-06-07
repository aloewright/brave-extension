// src/lib/github/registry.ts
import type { GitHubFeatureSettings } from "../../types"
import cleanIssueLabels from "./features/clean-issue-labels"
import conversationLinks from "./features/conversation-links"
import copyFilePath from "./features/copy-file-path"
import defaultBranchButton from "./features/default-branch-button"
import expandAllFiles from "./features/expand-all-files"
import newRepoDisableProjectsAndWikis from "./features/new-repo-disable-projects-and-wikis"
import quickLabelRemoval from "./features/quick-label-removal"
import quickRepoDeletion from "./features/quick-repo-deletion"
import quickReview from "./features/quick-review"
import resizeRepositoryButtons from "./features/resize-repository-buttons"
import restoreFile from "./features/restore-file"
import showWhitespaceToggle from "./features/show-whitespace-toggle"
import stickyFileHeaders from "./features/sticky-file-headers"
import stickyPrTabs from "./features/sticky-pr-tabs"
import syncPrCommitTitle from "./features/sync-pr-commit-title"
import updatePrFromBaseBranch from "./features/update-pr-from-base-branch"
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
  cleanIssueLabels,
  conversationLinks,
  copyFilePath,
  defaultBranchButton,
  expandAllFiles,
  newRepoDisableProjectsAndWikis,
  quickLabelRemoval,
  quickRepoDeletion,
  quickReview,
  resizeRepositoryButtons,
  restoreFile,
  showWhitespaceToggle,
  stickyFileHeaders,
  stickyPrTabs,
  syncPrCommitTitle,
  updatePrFromBaseBranch,
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
