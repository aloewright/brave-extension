import { describe, expect, it } from "vitest"
import { z } from "zod"
import { toCodeModeTools } from "../src/ai/code-mode"

describe("toCodeModeTools", () => {
  it("maps ServerTools to TanStack server-tool shape", () => {
    const defs = toCodeModeTools([
      {
        name: "echo",
        description: "e",
        inputSchema: z.object({ m: z.string() }),
        server: async (i: any) => ({ m: i.m }),
      },
    ])
    expect(defs).toHaveLength(1)
    const tool = defs[0] as any
    expect(tool.name).toBe("echo")
    expect(tool.description).toBe("e")
    expect(tool.__toolSide).toBe("server")
    expect(typeof tool.execute).toBe("function")
  })

  it("omits outputSchema when not provided and includes it when present", () => {
    const out = z.object({ ok: z.boolean() })
    const defs = toCodeModeTools([
      {
        name: "a",
        description: "a",
        inputSchema: z.object({}),
        server: async () => ({ ok: true }),
      },
      {
        name: "b",
        description: "b",
        inputSchema: z.object({}),
        outputSchema: out,
        server: async () => ({ ok: true }),
      },
    ])
    expect((defs[0] as any).outputSchema).toBeUndefined()
    expect((defs[1] as any).outputSchema).toBeDefined()
  })

  it("server execute delegates to our ServerTool.server", async () => {
    const defs = toCodeModeTools([
      {
        name: "echo",
        description: "e",
        inputSchema: z.object({ m: z.string() }),
        server: async (i: any) => ({ echoed: i.m }),
      },
    ])
    const result = await (defs[0] as any).execute({ m: "hi" })
    expect(result).toEqual({ echoed: "hi" })
  })
})
