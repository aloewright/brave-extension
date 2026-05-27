// src/lib/joplin/folders.ts

import { get, post, put, del, paginate } from "./client"
import type {
  CreateFolderInput,
  JoplinFolder,
  JoplinNote,
  ListNotesOptions,
  PagedResponse,
  PagedResult,
  UpdateFolderPatch
} from "./types"

const DEFAULT_FOLDER_FIELDS = "id,title,parent_id,updated_time"
const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]

function limitForCap(cap: number | undefined): string {
  if (cap !== undefined && cap > 0 && cap < 100) return String(cap)
  return "100"
}

export async function listFolders(
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinFolder>> {
  return paginate<JoplinFolder>((page) =>
    get<PagedResponse<JoplinFolder>>("/folders", token, {
      query: { fields: DEFAULT_FOLDER_FIELDS, page: String(page) },
      fetchImpl
    })
  )
}

export async function getFolder(
  id: string,
  token: string,
  fetchImpl?: typeof fetch
): Promise<JoplinFolder> {
  return get<JoplinFolder>(`/folders/${encodeURIComponent(id)}`, token, {
    query: { fields: DEFAULT_FOLDER_FIELDS },
    fetchImpl
  })
}

export async function createFolder(
  input: CreateFolderInput,
  token: string,
  fetchImpl?: typeof fetch
): Promise<string> {
  const payload: Record<string, unknown> = { title: input.title }
  if (input.parentId !== undefined) payload.parent_id = input.parentId
  const res = await post<{ id?: string }>("/folders", token, payload, { fetchImpl })
  if (!res.id) throw new Error("Joplin /folders returned no id")
  return res.id
}

export async function updateFolder(
  id: string,
  patch: UpdateFolderPatch,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  const payload: Record<string, unknown> = {}
  if (patch.title !== undefined) payload.title = patch.title
  if (patch.parentId !== undefined) payload.parent_id = patch.parentId
  await put<unknown>(`/folders/${encodeURIComponent(id)}`, token, payload, {
    fetchImpl
  })
}

export async function deleteFolder(
  id: string,
  opts: { force?: boolean } | undefined,
  token: string,
  fetchImpl?: typeof fetch
): Promise<void> {
  await del(`/folders/${encodeURIComponent(id)}`, token, {
    query: opts?.force ? { force: "1" } : {},
    fetchImpl
  })
}

export async function listNotesInFolder(
  folderId: string,
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
        `/folders/${encodeURIComponent(folderId)}/notes`,
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
