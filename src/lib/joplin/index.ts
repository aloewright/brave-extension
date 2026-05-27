// src/lib/joplin/index.ts
//
// Public surface. Consumers import from "../lib/joplin"; the individual
// entity files are implementation details.

export { JOPLIN_BASE_URL, JoplinClientError } from "./client"

export type {
  CreateFolderInput,
  CreateNoteInput,
  JoplinFolder,
  JoplinNote,
  JoplinResource,
  JoplinTag,
  ListNotesOptions,
  PagedResponse,
  PagedResult,
  SearchOptions,
  UpdateFolderPatch,
  UpdateNotePatch,
  UploadResourceProps
} from "./types"

export { ping, joplinNoteUrl } from "./ping"

export {
  createNote,
  getNote,
  updateNote,
  deleteNote,
  listNotes,
  getNoteResources,
  getNoteTags
} from "./notes"

export {
  listFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  listNotesInFolder
} from "./folders"

export {
  listTags,
  createTag,
  deleteTag,
  addTagToNote,
  removeTagFromNote,
  listNotesByTag
} from "./tags"

export { searchNotes } from "./search"

export { getResource, uploadResource } from "./resources"

export {
  findOrCreateFolder,
  findOrCreateTag,
  addTagToNoteByName,
  appendToNote
} from "./composites"
