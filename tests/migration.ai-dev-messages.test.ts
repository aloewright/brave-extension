import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  addMessage,
  clearMessages,
  getMessages,
  getMessagesForBackend,
  setMessages
} from "../src/storage"
import type { ChatMessage, CLIBackend } from "../src/types"

const LEGACY_KEY = "ai-dev-messages"
const COMPLETE_KEY = "migration:ai-dev-messages-complete"
const shardKey = (backend: CLIBackend) => `ai-dev-messages-${backend}`
const markerKey = (backend: CLIBackend) =>
  `migration:ai-dev-messages:${backend}`

const BACKENDS: CLIBackend[] = ["claude", "gemini", "copilot", "codex"]

const msg = (
  overrides: Partial<ChatMessage> & Pick<ChatMessage, "id" | "timestamp">
): ChatMessage => ({
  role: "user",
  content: "hello",
  backend: "claude",
  ...overrides
})

const dump = (): Record<string, unknown> =>
  (chrome.storage.local as unknown as { __dump: () => Record<string, unknown> }).__dump()

const countCalls = (
  spy: ReturnType<typeof vi.spyOn>,
  keyMatch: (key: string) => boolean
): number =>
  spy.mock.calls.filter((call) => {
    const arg = call[0]
    if (arg == null) return true
    if (typeof arg === "string") return keyMatch(arg)
    if (Array.isArray(arg)) return arg.some(keyMatch)
    return Object.keys(arg as Record<string, unknown>).some(keyMatch)
  }).length

describe("ai-dev-messages migration — per-backend shard hardening (PDX-87)", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe("Case A — legacy-only state", () => {
    it("getMessagesForBackend('claude') hydrates the claude shard from legacy and leaves legacy in place until every backend has migrated", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" }),
        msg({ id: "L2", timestamp: 2, backend: "gemini" }),
        msg({ id: "L3", timestamp: 3, backend: "claude" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      const claude = await getMessagesForBackend("claude")
      expect(claude.map((m) => m.id)).toEqual(["L1", "L3"])

      // Shard populated, marker for claude set, but legacy still present
      // (gemini, copilot, codex have not migrated yet).
      const after = dump()
      expect(after[shardKey("claude")]).toBeDefined()
      expect(after[markerKey("claude")]).toBe(true)
      expect(after[LEGACY_KEY]).toBeDefined()
      expect(after[COMPLETE_KEY]).toBeUndefined()
      expect(after[markerKey("gemini")]).toBeUndefined()
    })

    it("re-running getMessagesForBackend('claude') is a no-op (idempotent — no second migration)", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" }),
        msg({ id: "L2", timestamp: 2, backend: "gemini" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      await getMessagesForBackend("claude")
      const snapshotAfterFirst = dump()

      const setSpy = vi.spyOn(chrome.storage.local, "set")
      const claudeAgain = await getMessagesForBackend("claude")
      expect(claudeAgain.map((m) => m.id)).toEqual(["L1"])
      // No new writes — second call short-circuits on the shard get.
      expect(setSpy).not.toHaveBeenCalled()

      // No double-sharding.
      expect(dump()).toEqual(snapshotAfterFirst)
    })

    it("getMessages() migrates every backend at once and removes the legacy key", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" }),
        msg({ id: "L2", timestamp: 2, backend: "gemini" }),
        msg({ id: "L3", timestamp: 3, backend: "copilot" }),
        msg({ id: "L4", timestamp: 4, backend: "codex" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      const all = await getMessages()
      expect(all.map((m) => m.id)).toEqual(["L1", "L2", "L3", "L4"])

      const after = dump()
      expect(after[LEGACY_KEY]).toBeUndefined()
      expect(after[COMPLETE_KEY]).toBe(true)
      for (const backend of BACKENDS) {
        expect(after[markerKey(backend)]).toBe(true)
      }
    })
  })

  describe("Case B — partially-migrated state", () => {
    it("getMessagesForBackend('openai-equivalent') migrates only the requested backend; existing shard wins, no double-sharding", async () => {
      // Pre-existing claude shard (already migrated) plus legacy still around.
      const claudeShard: ChatMessage[] = [
        msg({ id: "C1", timestamp: 10, backend: "claude" }),
        msg({ id: "C2", timestamp: 11, backend: "claude" })
      ]
      const legacy: ChatMessage[] = [
        // Stale claude entries that should NOT be re-applied to the shard.
        msg({ id: "L-old-claude", timestamp: 1, backend: "claude" }),
        msg({ id: "L-gemini", timestamp: 2, backend: "gemini" }),
        msg({ id: "L-codex", timestamp: 3, backend: "codex" })
      ]
      await chrome.storage.local.set({
        [shardKey("claude")]: claudeShard,
        [markerKey("claude")]: true,
        [LEGACY_KEY]: legacy
      })

      // Migrate gemini.
      const gemini = await getMessagesForBackend("gemini")
      expect(gemini.map((m) => m.id)).toEqual(["L-gemini"])

      const snap = dump()
      // Gemini shard populated, marker set.
      expect(snap[shardKey("gemini")]).toBeDefined()
      expect(snap[markerKey("gemini")]).toBe(true)
      // Claude shard untouched (no double-shard).
      expect(snap[shardKey("claude")]).toEqual(claudeShard)
      // Legacy still there — codex has not been migrated yet.
      expect(snap[LEGACY_KEY]).toBeDefined()
      expect(snap[COMPLETE_KEY]).toBeUndefined()

      // Calling gemini migration again does not re-shard.
      const setSpy = vi.spyOn(chrome.storage.local, "set")
      const gemAgain = await getMessagesForBackend("gemini")
      expect(gemAgain.map((m) => m.id)).toEqual(["L-gemini"])
      expect(setSpy).not.toHaveBeenCalled()
    })

    it("getMessages() over a partially-migrated store finishes migration without disturbing already-migrated shards", async () => {
      const claudeShard: ChatMessage[] = [
        msg({ id: "C1", timestamp: 10, backend: "claude" })
      ]
      const legacy: ChatMessage[] = [
        msg({ id: "L-claude-stale", timestamp: 1, backend: "claude" }),
        msg({ id: "L-gemini", timestamp: 2, backend: "gemini" }),
        msg({ id: "L-copilot", timestamp: 3, backend: "copilot" }),
        msg({ id: "L-codex", timestamp: 4, backend: "codex" })
      ]
      await chrome.storage.local.set({
        [shardKey("claude")]: claudeShard,
        [markerKey("claude")]: true,
        [LEGACY_KEY]: legacy
      })

      const all = await getMessages()
      // Stale claude legacy entries are NOT re-applied — claude shard wins.
      expect(all.map((m) => m.id).sort()).toEqual(
        ["C1", "L-codex", "L-copilot", "L-gemini"].sort()
      )

      const after = dump()
      expect(after[LEGACY_KEY]).toBeUndefined()
      expect(after[COMPLETE_KEY]).toBe(true)
      expect(after[shardKey("claude")]).toEqual(claudeShard)
    })
  })

  describe("Case C — already-migrated state (no legacy key)", () => {
    it("getMessagesForBackend('claude') uses a single storage round-trip when the shard is present", async () => {
      const claudeShard: ChatMessage[] = [
        msg({ id: "C1", timestamp: 1, backend: "claude" })
      ]
      await chrome.storage.local.set({
        [shardKey("claude")]: claudeShard,
        [markerKey("claude")]: true,
        [markerKey("gemini")]: true,
        [markerKey("copilot")]: true,
        [markerKey("codex")]: true,
        [COMPLETE_KEY]: true
      })

      const getSpy = vi.spyOn(chrome.storage.local, "get")
      const claude = await getMessagesForBackend("claude")
      expect(claude.map((m) => m.id)).toEqual(["C1"])
      // Exactly one get — no extra round-trip on cold start.
      expect(getSpy).toHaveBeenCalledTimes(1)
      expect(getSpy).toHaveBeenCalledWith(shardKey("claude"))
    })

    it("getMessagesForBackend on a cleaned-up store with no legacy key short-circuits without writing", async () => {
      // Only markers set, no legacy key, no shard for gemini.
      await chrome.storage.local.set({
        [markerKey("claude")]: true,
        [markerKey("gemini")]: true,
        [markerKey("copilot")]: true,
        [markerKey("codex")]: true,
        [COMPLETE_KEY]: true
      })

      const setSpy = vi.spyOn(chrome.storage.local, "set")
      const gemini = await getMessagesForBackend("gemini")
      expect(gemini).toEqual([])
      // No writes — already-migrated short-circuit.
      expect(setSpy).not.toHaveBeenCalled()
    })
  })

  describe("idempotency", () => {
    it("running migration twice produces identical state and no duplicate keys", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" }),
        msg({ id: "L2", timestamp: 2, backend: "gemini" }),
        msg({ id: "L3", timestamp: 3, backend: "claude" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      const firstAll = await getMessages()
      const firstSnap = dump()

      const secondAll = await getMessages()
      const secondSnap = dump()

      expect(secondAll).toEqual(firstAll)
      expect(secondSnap).toEqual(firstSnap)
    })

    it("running getMessagesForBackend across all backends migrates everything exactly once", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" }),
        msg({ id: "L2", timestamp: 2, backend: "gemini" }),
        msg({ id: "L3", timestamp: 3, backend: "copilot" }),
        msg({ id: "L4", timestamp: 4, backend: "codex" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      for (const backend of BACKENDS) {
        await getMessagesForBackend(backend)
      }

      const after = dump()
      // Legacy gone, complete flag set, every shard populated correctly.
      expect(after[LEGACY_KEY]).toBeUndefined()
      expect(after[COMPLETE_KEY]).toBe(true)
      expect(after[shardKey("claude")]).toEqual([legacy[0]])
      expect(after[shardKey("gemini")]).toEqual([legacy[1]])
      expect(after[shardKey("copilot")]).toEqual([legacy[2]])
      expect(after[shardKey("codex")]).toEqual([legacy[3]])

      // Run them all again — no further writes.
      const setSpy = vi.spyOn(chrome.storage.local, "set")
      for (const backend of BACKENDS) {
        await getMessagesForBackend(backend)
      }
      expect(setSpy).not.toHaveBeenCalled()
    })

    it("a defaulted-backend message in legacy is migrated to claude exactly once", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" }),
        // no backend → defaults to claude
        { id: "L2", role: "user", content: "x", timestamp: 2 } as ChatMessage
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      const claude1 = await getMessagesForBackend("claude")
      expect(claude1.map((m) => m.id)).toEqual(["L1", "L2"])
      const claude2 = await getMessagesForBackend("claude")
      expect(claude2.map((m) => m.id)).toEqual(["L1", "L2"])
    })
  })

  describe("setMessages writes shards and finalizes legacy cleanup", () => {
    it("setMessages writes per-backend shards and removes legacy when migration is complete", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      await setMessages([
        msg({ id: "S1", timestamp: 1, backend: "claude" }),
        msg({ id: "S2", timestamp: 2, backend: "gemini" })
      ])

      const after = dump()
      expect(after[shardKey("claude")]).toEqual([
        msg({ id: "S1", timestamp: 1, backend: "claude" })
      ])
      expect(after[shardKey("gemini")]).toEqual([
        msg({ id: "S2", timestamp: 2, backend: "gemini" })
      ])
      // Legacy cleaned up after full migration.
      expect(after[LEGACY_KEY]).toBeUndefined()
      expect(after[COMPLETE_KEY]).toBe(true)
    })
  })

  describe("addMessage interaction with legacy migration", () => {
    it("addMessage to a backend that has legacy content does not duplicate previously-migrated entries", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      // First read migrates claude.
      await getMessagesForBackend("claude")
      // Append a new message.
      await addMessage(msg({ id: "C2", timestamp: 2, backend: "claude" }))

      const claude = await getMessagesForBackend("claude")
      expect(claude.map((m) => m.id)).toEqual(["L1", "C2"])
    })
  })

  describe("cold-start round-trip count when legacy key is absent", () => {
    it("performs only a single chrome.storage.local.get when the shard exists", async () => {
      await chrome.storage.local.set({
        [shardKey("claude")]: [msg({ id: "C1", timestamp: 1, backend: "claude" })],
        [markerKey("claude")]: true
      })
      const getSpy = vi.spyOn(chrome.storage.local, "get")

      await getMessagesForBackend("claude")

      const getsThatTouchedLegacy = countCalls(getSpy, (k) => k === LEGACY_KEY)
      expect(getsThatTouchedLegacy).toBe(0)
      expect(getSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("clearMessages preserves migration markers", () => {
    it("clearMessages('claude') keeps the migration marker so the legacy key is not re-read", async () => {
      const legacy: ChatMessage[] = [
        msg({ id: "L1", timestamp: 1, backend: "claude" })
      ]
      await chrome.storage.local.set({ [LEGACY_KEY]: legacy })

      await getMessagesForBackend("claude") // migrate
      await clearMessages("claude")

      const claude = await getMessagesForBackend("claude")
      expect(claude).toEqual([])

      const snap = dump()
      expect(snap[markerKey("claude")]).toBe(true)
    })
  })
})
