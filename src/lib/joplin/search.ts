// src/lib/joplin/search.ts

import { get, paginate, limitForCap } from "./client"
import type {
  JoplinNote,
  PagedResponse,
  PagedResult,
  SearchOptions
} from "./types"

const DEFAULT_NOTE_FIELDS: ReadonlyArray<keyof JoplinNote> = [
  "id",
  "title",
  "parent_id",
  "updated_time"
]


export async function searchNotes(
  query: string,
  opts: SearchOptions,
  token: string,
  fetchImpl?: typeof fetch
): Promise<PagedResult<JoplinNote>> {
  const fields = (opts.fields ?? DEFAULT_NOTE_FIELDS).join(",")
  const orderBy = opts.orderBy ?? "updated_time"
  const orderDir = opts.orderDir ?? "DESC"
  const type = opts.type ?? "note"
  const limit = limitForCap(opts.cap)
  return paginate<JoplinNote>(
    (page) =>
      get<PagedResponse<JoplinNote>>("/search", token, {
        query: {
          query,
          type,
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
