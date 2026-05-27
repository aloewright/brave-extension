import { describe, it, expect, beforeEach, vi } from "vitest"
import type {
  JoplinFolder,
  JoplinTag,
  JoplinNote,
  PagedResult
} from "../src/lib/joplin/types"

const {
  listFoldersMock,
  createFolderMock,
  listTagsMock,
  createTagMock,
  addTagToNoteMock,
  getNoteMock,
  updateNoteMock
} = vi.hoisted(() => ({
  listFoldersMock: vi.fn(),
  createFolderMock: vi.fn(),
  listTagsMock: vi.fn(),
  createTagMock: vi.fn(),
  addTagToNoteMock: vi.fn(),
  getNoteMock: vi.fn(),
  updateNoteMock: vi.fn()
}))

vi.mock("../src/lib/joplin/folders", () => ({
  listFolders: listFoldersMock,
  createFolder: createFolderMock
}))
vi.mock("../src/lib/joplin/tags", () => ({
  listTags: listTagsMock,
  createTag: createTagMock,
  addTagToNote: addTagToNoteMock
}))
vi.mock("../src/lib/joplin/notes", () => ({
  getNote: getNoteMock,
  updateNote: updateNoteMock
}))

import {
  findOrCreateFolder,
  findOrCreateTag,
  addTagToNoteByName,
  appendToNote
} from "../src/lib/joplin/composites"

function paged<T>(items: T[]): PagedResult<T> {
  return { items, truncated: false }
}

beforeEach(() => {
  listFoldersMock.mockReset()
  createFolderMock.mockReset()
  listTagsMock.mockReset()
  createTagMock.mockReset()
  addTagToNoteMock.mockReset()
  getNoteMock.mockReset()
  updateNoteMock.mockReset()
})

describe("findOrCreateFolder", () => {
  it("returns existing folder id when title matches under parentId", async () => {
    listFoldersMock.mockResolvedValue(
      paged<JoplinFolder>([
        { id: "f1", title: "Inbox", parent_id: "p1" },
        { id: "f2", title: "Inbox", parent_id: "p2" }
      ])
    )
    const id = await findOrCreateFolder("Inbox", "p2", "tok")
    expect(id).toBe("f2")
    expect(createFolderMock).not.toHaveBeenCalled()
  })

  it("ignores match in the wrong parent", async () => {
    listFoldersMock.mockResolvedValue(
      paged<JoplinFolder>([{ id: "f1", title: "Inbox", parent_id: "p1" }])
    )
    createFolderMock.mockResolvedValue("f-new")
    const id = await findOrCreateFolder("Inbox", "p2", "tok")
    expect(id).toBe("f-new")
    expect(createFolderMock).toHaveBeenCalledWith(
      { title: "Inbox", parentId: "p2" },
      "tok",
      undefined
    )
  })

  it("creates and returns new id when no match", async () => {
    listFoldersMock.mockResolvedValue(paged<JoplinFolder>([]))
    createFolderMock.mockResolvedValue("f-new")
    const id = await findOrCreateFolder("New", undefined, "tok")
    expect(id).toBe("f-new")
  })

  it("treats title case-sensitively (Joplin behavior)", async () => {
    listFoldersMock.mockResolvedValue(
      paged<JoplinFolder>([{ id: "f1", title: "Inbox" }])
    )
    createFolderMock.mockResolvedValue("f-new")
    const id = await findOrCreateFolder("inbox", undefined, "tok")
    expect(id).toBe("f-new") // case mismatch → create new
  })
})

describe("findOrCreateTag", () => {
  it("lowercases title for lookup", async () => {
    listTagsMock.mockResolvedValue(
      paged<JoplinTag>([{ id: "t1", title: "urgent" }])
    )
    const id = await findOrCreateTag("URGENT", "tok")
    expect(id).toBe("t1")
    expect(createTagMock).not.toHaveBeenCalled()
  })

  it("creates the tag with lowercased title when not found", async () => {
    listTagsMock.mockResolvedValue(paged<JoplinTag>([]))
    createTagMock.mockResolvedValue("t-new")
    const id = await findOrCreateTag("Urgent", "tok")
    expect(id).toBe("t-new")
    expect(createTagMock).toHaveBeenCalledWith("urgent", "tok", undefined)
  })

  it("throws on empty/whitespace title", async () => {
    await expect(findOrCreateTag("   ", "tok")).rejects.toThrow(
      /cannot be empty/
    )
    await expect(findOrCreateTag("", "tok")).rejects.toThrow(/cannot be empty/)
  })
})

describe("addTagToNoteByName", () => {
  it("composes findOrCreateTag + addTagToNote", async () => {
    listTagsMock.mockResolvedValue(paged<JoplinTag>([]))
    createTagMock.mockResolvedValue("t-new")
    addTagToNoteMock.mockResolvedValue(undefined)
    await addTagToNoteByName("n1", "urgent", "tok")
    expect(createTagMock).toHaveBeenCalled()
    expect(addTagToNoteMock).toHaveBeenCalledWith("n1", "t-new", "tok", undefined)
  })
})

describe("appendToNote", () => {
  it("appends with \\n\\n separator when body has no trailing newline", async () => {
    getNoteMock.mockResolvedValue({ id: "n1", body: "existing" } as JoplinNote)
    updateNoteMock.mockResolvedValue(undefined)
    await appendToNote("n1", "new text", "tok")
    expect(updateNoteMock).toHaveBeenCalledWith(
      "n1",
      { body: "existing\n\nnew text" },
      "tok",
      undefined
    )
  })

  it("uses single \\n separator when body ends with one newline", async () => {
    getNoteMock.mockResolvedValue({ id: "n1", body: "existing\n" } as JoplinNote)
    updateNoteMock.mockResolvedValue(undefined)
    await appendToNote("n1", "new text", "tok")
    expect(updateNoteMock).toHaveBeenCalledWith(
      "n1",
      { body: "existing\nnew text" },
      "tok",
      undefined
    )
  })

  it("writes text directly when body is empty", async () => {
    getNoteMock.mockResolvedValue({ id: "n1", body: "" } as JoplinNote)
    updateNoteMock.mockResolvedValue(undefined)
    await appendToNote("n1", "new", "tok")
    expect(updateNoteMock).toHaveBeenCalledWith(
      "n1",
      { body: "new" },
      "tok",
      undefined
    )
  })
})
