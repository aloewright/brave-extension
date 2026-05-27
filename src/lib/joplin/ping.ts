// src/lib/joplin/ping.ts
//
// Migrated from the legacy joplin-client.ts. /ping is unauthenticated;
// joplinNoteUrl is a pure formatter for joplin:// deep links.

import { JOPLIN_BASE_URL } from "./client"

export async function ping(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`${JOPLIN_BASE_URL}/ping`)
    if (!res.ok) return false
    const body = await res.text()
    return body.includes("JoplinClipperServer")
  } catch {
    return false
  }
}

export function joplinNoteUrl(noteId: string): string {
  return `joplin://x-callback-url/openNote?id=${noteId}`
}
