// src/lib/joplin-recents.ts
//
// Bounded-list storage for recent Joplin clips. Cap is 50; newest-first
// ordering. Storage key matches the spec's data-model section.

import { Storage } from "@plasmohq/storage"
import type { RecentClip } from "./joplin-types"

const STORAGE_KEY = "ai-dev-joplin-recent-clips"
const MAX_CLIPS = 50

const storage = new Storage()

export async function getRecentClips(): Promise<RecentClip[]> {
  const raw = await storage.get<{ clips: RecentClip[] }>(STORAGE_KEY)
  return Array.isArray(raw?.clips) ? raw!.clips : []
}

export async function prependRecentClip(clip: RecentClip): Promise<void> {
  const existing = await getRecentClips()
  const updated = [clip, ...existing].slice(0, MAX_CLIPS)
  await storage.set(STORAGE_KEY, { clips: updated })
}

export async function clearRecentClips(): Promise<void> {
  await storage.remove(STORAGE_KEY)
}
