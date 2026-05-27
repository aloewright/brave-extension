// src/lib/joplin-clip-handler.ts
//
// The integration layer for one clip. Extracted from background.ts so
// it can be unit-tested without spinning up a service worker. Pure
// async function that takes a ClipRequest + a settings-getter and
// returns nothing — side effects: storage write + sendMessage broadcast.

import { extractClip } from "./clip-extractors"
import { createNote, joplinNoteUrl } from "./joplin"
import { prependRecentClip } from "./joplin-recents"
import type {
  ClipRequest,
  ClipResultEvent,
  RecentClip
} from "./joplin-types"

interface Deps {
  getJoplinToken: () => Promise<string>
  /** Mockable wrapper around chrome.runtime.sendMessage. */
  broadcast: (event: ClipResultEvent) => void
  /** Mockable id generator. Default uses src/lib/ulid. */
  newId: () => string
  /** Mockable now(). */
  now: () => Date
}

export async function handleClipRequest(
  req: ClipRequest,
  deps: Deps
): Promise<void> {
  try {
    const token = await deps.getJoplinToken()
    const clip = await extractClip(req.tabId, req.mode)
    const noteId = await createNote(
      {
        title: clip.title,
        body: clip.body ?? undefined,
        bodyHtml: clip.bodyHtml ?? undefined,
        sourceUrl: clip.sourceUrl
      },
      token
    )
    const recent: RecentClip = {
      id: deps.newId(),
      joplinNoteId: noteId,
      title: clip.title,
      mode: req.mode,
      sourceUrl: clip.sourceUrl,
      createdAt: deps.now().toISOString(),
      joplinUrl: joplinNoteUrl(noteId)
    }
    try {
      await prependRecentClip(recent)
    } catch (err) {
      console.warn("[joplin-clip] failed to persist recent clip", err)
    }
    deps.broadcast({
      type: "joplin/clip-result",
      status: "success",
      mode: req.mode,
      title: clip.title,
      recentClip: recent
    })
  } catch (err) {
    deps.broadcast({
      type: "joplin/clip-result",
      status: "error",
      mode: req.mode,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}
