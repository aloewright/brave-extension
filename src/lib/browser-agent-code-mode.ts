/**
 * Compact operation catalog for the browser agent's future Code Mode wrapper.
 * The model should see these as a tiny typed SDK rather than individual tool
 * schemas for every browser operation.
 */

export type BrowserAgentOperation =
  | "browser.observe"
  | "browser.click"
  | "browser.type"
  | "browser.scroll"
  | "browser.wait"
  | "browser.navigate"
  | "memory.search"
  | "memory.remember"
  | "session.compact"

export const BROWSER_AGENT_OPERATIONS: readonly BrowserAgentOperation[] = [
  "browser.observe",
  "browser.click",
  "browser.type",
  "browser.scroll",
  "browser.wait",
  "browser.navigate",
  "memory.search",
  "memory.remember",
  "session.compact"
] as const

export function isBrowserAgentOperation(value: string): value is BrowserAgentOperation {
  return (BROWSER_AGENT_OPERATIONS as readonly string[]).includes(value)
}
