// src/lib/joplin/composites.ts
//
// Higher-level helpers composing multiple library fns. Each composite
// is itself a library export (re-exported from index.ts) so the AI
// chat tools can use them directly without re-composing.

import { listFolders, createFolder } from "./folders"
import { listTags, createTag, addTagToNote } from "./tags"
import { getNote, updateNote } from "./notes"

export async function findOrCreateFolder(
  title: string,
  parentId: string | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const { items } = await listFolders(token, fetchImpl)
  const match = items.find(
    (f) =>
      f.title === title && (parentId === undefined || f.parent_id === parentId)
  )
  if (match) return match.id
  return createFolder({ title, parentId }, token, fetchImpl)
}

export async function findOrCreateTag(
  title: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const needle = title.trim().toLowerCase()
  if (!needle) throw new Error("Tag title cannot be empty.")
  const { items } = await listTags(token, fetchImpl)
  const match = items.find((t) => t.title.toLowerCase() === needle)
  if (match) return match.id
  return createTag(needle, token, fetchImpl)
}

export async function addTagToNoteByName(
  noteId: string,
  tagName: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const tagId = await findOrCreateTag(tagName, token, fetchImpl)
  await addTagToNote(noteId, tagId, token, fetchImpl)
}

export async function appendToNote(
  noteId: string,
  text: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const current = await getNote(noteId, ["id", "body"], token, fetchImpl)
  const existing = current.body ?? ""
  // If body is empty: no separator. If body ends with \n: the trailing
  // newline already separates, so just append. Otherwise add \n\n.
  const sep =
    existing.length === 0 ? "" : existing.endsWith("\n") ? "" : "\n\n"
  const next = existing + sep + text
  await updateNote(noteId, { body: next }, token, fetchImpl)
}
