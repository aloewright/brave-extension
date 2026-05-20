import { beforeEach, describe, expect, it } from "vitest"
import { makeEnv } from "./helpers"
import type { Env } from "../src/env"
import {
  deleteConversation,
  getConversation,
  insertConversation,
  listConversations,
  updateConversation,
  upsertLink,
  getLink,
  listLinks,
  deleteLink,
  insertBookmark,
  getBookmark,
  listBookmarks,
  updateBookmark,
  deleteBookmark,
  listAllBookmarksDiffShape,
  type BookmarkRow,
  insertRecording,
  getRecording,
  listRecordings,
  updateRecording,
  deleteRecording,
  type RecordingRow
} from "../src/db"

describe("db", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  it("inserts and reads a conversation", async () => {
    await insertConversation(env, {
      id: "c1", backend: "claude", title: "t", content_text: "x",
      message_count: 1, chunk_count: 0, started_at: 1, updated_at: 1
    })
    const got = await getConversation(env, "c1")
    expect(got?.title).toBe("t")
  })

  it("lists conversations newest-first and respects limit", async () => {
    for (let i = 1; i <= 3; i++) {
      await insertConversation(env, {
        id: `c${i}`, backend: "claude", title: `t${i}`, content_text: "",
        message_count: 0, chunk_count: 0, started_at: i, updated_at: i
      })
    }
    const rows = await listConversations(env, { limit: 2 })
    expect(rows.map((r) => r.id)).toEqual(["c3", "c2"])
  })

  it("filters conversations by backend", async () => {
    await insertConversation(env, {
      id: "a", backend: "claude", title: "", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    await insertConversation(env, {
      id: "b", backend: "gemini", title: "", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    const rows = await listConversations(env, { backend: "gemini" })
    expect(rows.map((r) => r.id)).toEqual(["b"])
  })

  it("updates a conversation and bumps updated_at", async () => {
    await insertConversation(env, {
      id: "c1", backend: "claude", title: "old", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    await updateConversation(env, "c1", { title: "new", updated_at: 5 })
    const got = await getConversation(env, "c1")
    expect(got?.title).toBe("new")
    expect(got?.updated_at).toBe(5)
  })

  it("deletes a conversation", async () => {
    await insertConversation(env, {
      id: "c1", backend: "claude", title: "", content_text: "",
      message_count: 0, chunk_count: 0, started_at: 1, updated_at: 1
    })
    await deleteConversation(env, "c1")
    expect(await getConversation(env, "c1")).toBeNull()
  })

  it("upserts a link by URL (creates new)", async () => {
    const r = await upsertLink(env, {
      id: "l1", url: "https://example.com", title: "ex", description: null,
      tags: '["a"]', favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    expect(r).toEqual({ id: "l1", created: true })
  })

  it("upserts a link by URL (updates existing, keeps original id)", async () => {
    await upsertLink(env, {
      id: "l1", url: "https://example.com", title: "first", description: null,
      tags: "[]", favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    const r = await upsertLink(env, {
      id: "l2", url: "https://example.com", title: "second", description: null,
      tags: "[]", favicon: null, source: "manual", chunk_count: 0,
      created_at: 2, updated_at: 2
    })
    expect(r).toEqual({ id: "l1", created: false })
    expect((await getLink(env, "l1"))?.title).toBe("second")
    expect(await getLink(env, "l2")).toBeNull()
  })

  it("lists and filters links by tag", async () => {
    await upsertLink(env, {
      id: "l1", url: "https://a.com", title: "a", description: null,
      tags: '["red","blue"]', favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    await upsertLink(env, {
      id: "l2", url: "https://b.com", title: "b", description: null,
      tags: '["green"]', favicon: null, source: "manual", chunk_count: 0,
      created_at: 2, updated_at: 2
    })
    const red = await listLinks(env, { tag: "red" })
    expect(red.map((r) => r.id)).toEqual(["l1"])
  })

  it("deletes a link", async () => {
    await upsertLink(env, {
      id: "l1", url: "https://a.com", title: "a", description: null,
      tags: "[]", favicon: null, source: "manual", chunk_count: 0,
      created_at: 1, updated_at: 1
    })
    await deleteLink(env, "l1")
    expect(await getLink(env, "l1")).toBeNull()
  })
})

describe("db - bookmarks", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  function row(id: string, overrides: Partial<BookmarkRow> = {}): BookmarkRow {
    return {
      id,
      url: `https://${id}.example`,
      title: `t-${id}`,
      parent_id: null,
      path: "[]",
      category: "Unfiled",
      is_favorite: 0,
      date_added: null,
      position: 0,
      chunk_count: 0,
      synced_at: 1,
      ...overrides
    }
  }

  it("inserts and reads a bookmark", async () => {
    await insertBookmark(env, row("b1"))
    const got = await getBookmark(env, "b1")
    expect(got?.title).toBe("t-b1")
    expect(got?.url).toBe("https://b1.example")
  })

  it("filters by category", async () => {
    await insertBookmark(env, row("b1", { category: "Work" }))
    await insertBookmark(env, row("b2", { category: "Personal" }))
    const rows = await listBookmarks(env, { category: "Work" })
    expect(rows.map((r) => r.id)).toEqual(["b1"])
  })

  it("filters favorites", async () => {
    await insertBookmark(env, row("b1", { is_favorite: 1 }))
    await insertBookmark(env, row("b2", { is_favorite: 0 }))
    const favs = await listBookmarks(env, { favorite: true })
    expect(favs.map((r) => r.id)).toEqual(["b1"])
    const non = await listBookmarks(env, { favorite: false })
    expect(non.map((r) => r.id)).toEqual(["b2"])
  })

  it("updates a bookmark", async () => {
    await insertBookmark(env, row("b1", { title: "old" }))
    await updateBookmark(env, row("b1", { title: "new", synced_at: 5 }))
    const got = await getBookmark(env, "b1")
    expect(got?.title).toBe("new")
    expect(got?.synced_at).toBe(5)
  })

  it("deletes a bookmark", async () => {
    await insertBookmark(env, row("b1"))
    await deleteBookmark(env, "b1")
    expect(await getBookmark(env, "b1")).toBeNull()
  })

  it("listAllBookmarksDiffShape returns id/url/title/chunk_count for every row", async () => {
    await insertBookmark(env, row("b1", { chunk_count: 2 }))
    await insertBookmark(env, row("b2", { chunk_count: 1 }))
    const all = await listAllBookmarksDiffShape(env)
    expect(all).toHaveLength(2)
    expect(all.find((r) => r.id === "b1")).toEqual({
      id: "b1",
      url: "https://b1.example",
      title: "t-b1",
      chunk_count: 2
    })
  })
})

describe("db - recordings", () => {
  let env: Env

  beforeEach(() => {
    env = makeEnv()
  })

  function row(id: string, overrides: Partial<RecordingRow> = {}): RecordingRow {
    return {
      id,
      filename: `${id}.mp4`,
      mime_type: "video/mp4",
      duration_ms: 1000,
      size_bytes: 100,
      source: "screen",
      origin_url: null,
      r2_key: `recordings/${id}.mp4`,
      transcript: null,
      status: "pending",
      status_message: null,
      workflow_id: null,
      chunk_count: 0,
      created_at: 1,
      updated_at: 1,
      ...overrides
    }
  }

  it("inserts and reads a recording", async () => {
    await insertRecording(env, row("r1"))
    const got = await getRecording(env, "r1")
    expect(got?.filename).toBe("r1.mp4")
    expect(got?.status).toBe("pending")
  })

  it("lists recordings newest-first", async () => {
    await insertRecording(env, row("r1", { created_at: 1 }))
    await insertRecording(env, row("r2", { created_at: 2 }))
    await insertRecording(env, row("r3", { created_at: 3 }))
    const rows = await listRecordings(env)
    expect(rows.map((r) => r.id)).toEqual(["r3", "r2", "r1"])
  })

  it("filters by status", async () => {
    await insertRecording(env, row("r1", { status: "pending" }))
    await insertRecording(env, row("r2", { status: "ready" }))
    const pending = await listRecordings(env, { status: "pending" })
    expect(pending.map((r) => r.id)).toEqual(["r1"])
  })

  it("updates patch fields and bumps updated_at", async () => {
    await insertRecording(env, row("r1"))
    await updateRecording(env, "r1", {
      status: "ready",
      transcript: "hello",
      chunk_count: 3,
      updated_at: 99
    })
    const got = await getRecording(env, "r1")
    expect(got?.status).toBe("ready")
    expect(got?.transcript).toBe("hello")
    expect(got?.chunk_count).toBe(3)
    expect(got?.updated_at).toBe(99)
  })

  it("deletes a recording", async () => {
    await insertRecording(env, row("r1"))
    await deleteRecording(env, "r1")
    expect(await getRecording(env, "r1")).toBeNull()
  })
})
