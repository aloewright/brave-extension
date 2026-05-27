// src/lib/joplin/types.ts
//
// Shared types for the Joplin library. Single source of truth — imported
// by every entity file, the composites file, and the public barrel.

export interface JoplinNote {
  id: string
  title: string
  body?: string
  body_html?: string
  parent_id?: string
  source_url?: string
  created_time?: number          // ms since epoch
  updated_time?: number
  user_created_time?: number
  user_updated_time?: number
  is_todo?: 0 | 1
  todo_completed?: 0 | 1
  todo_due?: number              // ms since epoch (0 = no due date)
  encryption_applied?: 0 | 1
  markup_language?: 1 | 2         // 1 = Markdown, 2 = HTML
}

export interface JoplinFolder {
  id: string
  title: string
  parent_id?: string             // "" or omitted for top-level
  created_time?: number
  updated_time?: number
  user_created_time?: number
  user_updated_time?: number
  share_id?: string
  is_shared?: 0 | 1
}

export interface JoplinTag {
  id: string
  title: string
  created_time?: number
  updated_time?: number
  parent_id?: string
}

export interface JoplinResource {
  id: string
  title?: string
  mime?: string
  filename?: string
  file_extension?: string
  size?: number
  created_time?: number
  updated_time?: number
  encryption_applied?: 0 | 1
  encryption_blob_encrypted?: 0 | 1
}

export interface CreateNoteInput {
  title: string
  body?: string
  bodyHtml?: string
  sourceUrl?: string
  parentId?: string
  isTodo?: boolean
  todoDue?: number               // ms since epoch
}

export interface UpdateNotePatch {
  title?: string
  body?: string
  parentId?: string
  isTodo?: boolean
  todoCompleted?: boolean
  todoDue?: number               // 0 clears the due date
}

export interface CreateFolderInput {
  title: string
  parentId?: string
}

export interface UpdateFolderPatch {
  title?: string
  parentId?: string
}

export interface UploadResourceProps {
  title?: string
  filename?: string
  mime?: string
}

export interface PagedResponse<T> {
  items: T[]
  has_more: boolean
}

export interface PagedResult<T> {
  items: T[]
  truncated: boolean             // true if cap was hit or has_more was still true after cap
}

export interface ListNotesOptions {
  fields?: ReadonlyArray<keyof JoplinNote>
  cap?: number                                 // default 1000; 0 = unbounded
  orderBy?: "id" | "title" | "created_time" | "updated_time" | "user_updated_time"
  orderDir?: "ASC" | "DESC"                    // default "DESC"
}

export interface SearchOptions extends ListNotesOptions {
  type?: "note" | "folder" | "tag" | "resource"  // default "note"
}
