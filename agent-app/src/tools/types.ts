// src/tools/types.ts
import type { z } from "zod"

/** A tool exposed to Code Mode as external_<name>. Mirrors TanStack AI ServerTool. */
export interface ServerTool {
  name: string
  description: string
  inputSchema: z.ZodType<any>
  outputSchema?: z.ZodType<any>
  server: (input: any) => Promise<unknown>
}

export type ToolSourceStatus =
  | { state: "connected"; tools: number }
  | { state: "degraded"; tools: number; reason: string }
  | { state: "needs-auth"; reason: string }
  | { state: "needs-config"; reason: string }
  | { state: "failed"; reason: string }

export interface ToolSource {
  id: string
  listTools(): Promise<ServerTool[]>
  status(): Promise<ToolSourceStatus>
}
