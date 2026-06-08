import type { ServerTool, ToolSource, ToolSourceStatus } from "./types"
import { log } from "../log"

export async function buildToolRegistry(sources: ToolSource[]): Promise<{ tools: ServerTool[] }> {
  const tools: ServerTool[] = []
  for (const src of sources) {
    try {
      tools.push(...(await src.listTools()))
    } catch (e) {
      log.warn("registry.source_excluded", {
        source: src.id,
        error: e instanceof Error ? e.message : String(e)
      })
    }
  }
  return { tools }
}

export async function aggregateStatus(
  sources: ToolSource[]
): Promise<Array<{ id: string; status: ToolSourceStatus }>> {
  return Promise.all(
    sources.map(async (s) => {
      try {
        return { id: s.id, status: await s.status() }
      } catch (e) {
        return {
          id: s.id,
          status: {
            state: "failed",
            reason: e instanceof Error ? e.message : "error"
          } as ToolSourceStatus
        }
      }
    })
  )
}
