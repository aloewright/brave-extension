import { describe, expect, it } from "vitest"
import type { ToolSource } from "../src/tools/types"
import { buildToolRegistry, aggregateStatus } from "../src/tools/registry"

const ok = (id: string, names: string[]): ToolSource => ({
  id,
  listTools: async () =>
    names.map((n) => ({ name: n, description: "", inputSchema: {} as any, server: async () => ({}) })),
  status: async () => ({ state: "connected", tools: names.length })
})
const broken = (id: string): ToolSource => ({
  id,
  listTools: async () => {
    throw new Error("boom")
  },
  status: async () => ({ state: "failed", reason: "boom" })
})

describe("registry", () => {
  it("merges tools from healthy sources and excludes broken ones", async () => {
    const { tools } = await buildToolRegistry([ok("a", ["x"]), broken("b"), ok("c", ["y"])])
    expect(tools.map((t) => t.name).sort()).toEqual(["x", "y"])
  })
  it("aggregateStatus reports per-source", async () => {
    const st = await aggregateStatus([ok("a", ["x"]), broken("b")])
    expect(st.find((s) => s.id === "a")?.status.state).toBe("connected")
    expect(st.find((s) => s.id === "b")?.status.state).toBe("failed")
  })
})
