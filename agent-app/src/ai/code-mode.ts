import { toolDefinition } from "@tanstack/ai"
import { createCodeMode } from "@tanstack/ai-code-mode"
import { createCloudflareIsolateDriver } from "@tanstack/ai-isolate-cloudflare"
import type { Env } from "../env"
import type { ServerTool } from "../tools/types"

/** Convert our ServerTool[] into TanStack AI server tools for createCodeMode. */
export function toCodeModeTools(tools: ServerTool[]) {
  return tools.map((t) =>
    toolDefinition({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
    }).server(async (input: unknown) => t.server(input)),
  )
}

export function buildCodeMode(env: Env, selfOrigin: string, tools: ServerTool[]) {
  const driver = createCloudflareIsolateDriver({
    workerUrl: `${selfOrigin}/internal/code-exec`,
    authorization: `Bearer ${env.CODE_EXEC_TOKEN ?? ""}`,
    timeout: 30_000,
    maxToolRounds: 10,
  })
  return createCodeMode({ driver, tools: toCodeModeTools(tools), timeout: 30_000 })
}
