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
  deleteLink
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
