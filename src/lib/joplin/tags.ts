// src/lib/joplin/tags.ts

import { get, post, del, paginate, limitForCap } from "./client"
import type {
  JoplinNote,
  JoplinTag,
  ListNotesOptions,
  PagedResponse,
  PagedResult
} from "./types"

const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]


export async function listTags(
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinTag>> {
  return paginate<JoplinTag>((page) =>
    get<PagedResponse<JoplinTag>>("/tags", token, {
      query: { fields: "id,title", page: String(page) },
      fetchImpl
    })
  )
}

export async function createTag(
  title: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const res = await post<{ id?: string }>("/tags", token, { title }, { fetchImpl })
  if (!res.id) throw new Error("Joplin /tags returned no id")
  return res.id
}

export async function deleteTag(
  id: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(`/tags/${encodeURIComponent(id)}`, token, { fetchImpl })
}

export async function addTagToNote(
  noteId: string,
  tagId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await post<unknown>(
    `/tags/${encodeURIComponent(tagId)}/notes`,
    token,
    { id: noteId },
    { fetchImpl }
  )
}

export async function removeTagFromNote(
  noteId: string,
  tagId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(
    `/tags/${encodeURIComponent(tagId)}/notes/${encodeURIComponent(noteId)}`,
    token,
    { fetchImpl }
  )
}

export async function listNotesByTag(
  tagId: string,
  opts: ListNotesOptions,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinNote>> {
  const fields = (opts.fields ?? DEFAULT_NOTE_FIELDS).join(",")
  const orderBy = opts.orderBy ?? "updated_time"
  const orderDir = opts.orderDir ?? "DESC"
  const limit = limitForCap(opts.cap)
  return paginate<JoplinNote>(
    (page) =>
      get<PagedResponse<JoplinNote>>(
        `/tags/${encodeURIComponent(tagId)}/notes`,
        token,
        {
          query: {
            fields,
            order_by: orderBy,
            order_dir: orderDir,
            page: String(page),
            limit
          },
          fetchImpl
        }
      ),
    opts.cap
  )
}
