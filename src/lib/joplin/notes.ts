// src/lib/joplin/notes.ts

import { get, post, put, del, paginate } from "./client"
import type {
  CreateNoteInput,
  JoplinNote,
  JoplinResource,
  JoplinTag,
  ListNotesOptions,
  PagedResponse,
  PagedResult,
  UpdateNotePatch
} from "./types"

const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]

function limitForCap(cap: number | undefined): string {
  // Per Section 4 refinement: if caller's cap is below Joplin's max of
  // 100 per page, ask Joplin for exactly that many to avoid wasted bytes.
  if (cap !== undefined && cap > 0 && cap < 100) return String(cap)
  return "100"
}

export async function createNote(
  input: CreateNoteInput,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const payload: Record<string, unknown> = { title: input.title }
  if (input.body !== undefined) payload.body = input.body
  if (input.bodyHtml !== undefined) payload.body_html = input.bodyHtml
  if (input.sourceUrl !== undefined) payload.source_url = input.sourceUrl
  if (input.parentId !== undefined) payload.parent_id = input.parentId
  if (input.isTodo !== undefined) payload.is_todo = input.isTodo ? 1 : 0
  if (input.todoDue !== undefined) payload.todo_due = input.todoDue
  const res = await post<{ id?: string }>("/notes", token, payload, { fetchImpl })
  if (!res.id) throw new Error("Joplin /notes returned no id")
  return res.id
}

export async function getNote(
  id: string,
  fields: ReadonlyArray<keyof JoplinNote> | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<JoplinNote> {
  const f = fields ?? DEFAULT_NOTE_FIELDS
  return get<JoplinNote>(`/notes/${encodeURIComponent(id)}`, token, {
    query: { fields: f.join(",") },
    fetchImpl
  })
}

export async function updateNote(
  id: string,
  patch: UpdateNotePatch,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (patch.title !== undefined) payload.title = patch.title
  if (patch.body !== undefined) payload.body = patch.body
  if (patch.parentId !== undefined) payload.parent_id = patch.parentId
  if (patch.isTodo !== undefined) payload.is_todo = patch.isTodo ? 1 : 0
  if (patch.todoCompleted !== undefined)
    payload.todo_completed = patch.todoCompleted ? 1 : 0
  if (patch.todoDue !== undefined) payload.todo_due = patch.todoDue
  await put<unknown>(`/notes/${encodeURIComponent(id)}`, token, payload, {
    fetchImpl
  })
}

export async function deleteNote(
  id: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(`/notes/${encodeURIComponent(id)}`, token, { fetchImpl })
}

export async function listNotes(
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
      get<PagedResponse<JoplinNote>>("/notes", token, {
        query: {
          fields,
          order_by: orderBy,
          order_dir: orderDir,
          page: String(page),
          limit
        },
        fetchImpl
      }),
    opts.cap
  )
}

export async function getNoteResources(
  noteId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinResource>> {
  return paginate<JoplinResource>((page) =>
    get<PagedResponse<JoplinResource>>(
      `/notes/${encodeURIComponent(noteId)}/resources`,
      token,
      { query: { page: String(page) }, fetchImpl }
    )
  )
}

export async function getNoteTags(
  noteId: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinTag>> {
  return paginate<JoplinTag>((page) =>
    get<PagedResponse<JoplinTag>>(
      `/notes/${encodeURIComponent(noteId)}/tags`,
      token,
      { query: { page: String(page) }, fetchImpl }
    )
  )
}
