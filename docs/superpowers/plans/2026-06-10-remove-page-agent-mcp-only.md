# Remove Page Agent, Keep MCP Browser Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the broken in-page agent (overlay, Foundation Models planner, Hindsight memory) so the extension's browser tools are consumed exclusively through the already-working MCP server, plus two small robustness fixes.

**Architecture:** The MCP exposure already exists end-to-end: `native-host/mcp-server.mjs` registers `DOM_TOOL_DEFS` + `tabs_list`, bridges calls over native messaging to `handleMcpToolCall` in `src/background.ts`, which dispatches to `DOM_TOOL_HANDLERS` through the consent FSM. This plan is therefore almost entirely deletion: the page-agent overlay content script, its background message handlers, the planner/program executor, the Hindsight client, and the cloud-chat payload helper whose only consumer is the deleted handler. Two small fixes ride along: bump the native bridge tool-call timeout from 15s to 30s, and clarify the "no active tab" error message.

**Tech Stack:** Plasmo browser extension (TypeScript), Node native host (ESM .mjs), vitest (plain node environment — never vitest-pool-workers), pnpm.

**Spec:** `docs/superpowers/specs/2026-06-10-browser-tools-mcp-design.md`

**⚠️ Dirty working tree:** `src/background.ts`, `src/components/SidebarRail.tsx`, `package.json`, and several native-host files have uncommitted changes from other in-flight work. Do NOT `git stash`, `git checkout --`, or commit files this plan doesn't touch. Every commit below stages explicit paths only. If a `git add` path is already dirty from unrelated work (notably `src/background.ts` and `package.json`), the unrelated hunks will ride along in the commit — flag this to the user at the first commit that touches such a file and ask whether to proceed or have them commit their in-flight work first.

**Verification command reference:**
- Single test file: `pnpm vitest run tests/<file>` (expect PASS unless stated)
- Full suite: `pnpm test`
- Type check: `npx tsc --noEmit` (no dedicated script; plasmo build also type-checks)

---

### Task 1: Remove the rail quick action and its tests

The "Page agent" rail button toggles the overlay we're deleting. Remove the quick action, the rail entry, and the tests that pin them.

**Files:**
- Modify: `src/lib/quick-actions.ts`
- Modify: `src/components/SidebarRail.tsx`
- Modify: `tests/sidebar-rail.test.tsx`
- Delete: `tests/page-agent-ui.test.ts`

- [ ] **Step 1: Delete the obsolete tests first**

Delete the whole file `tests/page-agent-ui.test.ts` (it greps `quick-actions.ts` and `src/contents/page-agent.ts` source for page-agent strings):

```bash
git rm tests/page-agent-ui.test.ts
```

In `tests/sidebar-rail.test.tsx`, make two edits.

Edit 1 — remove the quick-action export assertion (keep the other three):

```typescript
// OLD:
    expect(typeof mod.runSaveLinkQuickAction).toBe("function")
    expect(typeof mod.runPageAgentQuickAction).toBe("function")
  })

// NEW:
    expect(typeof mod.runSaveLinkQuickAction).toBe("function")
  })
```

Edit 2 — delete this entire test:

```typescript
  it("keeps the Page agent toggle at the bottom of the rail actions", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/SidebarRail.tsx"),
      "utf8"
    )
    expect(source).toContain('label: "Page agent"')
    expect(source).toContain('icon: "cloud"')
    expect(source.indexOf('label: "Save link"')).toBeLessThan(source.indexOf('label: "Page agent"'))
  })
```

- [ ] **Step 2: Run the rail test to verify it now FAILS (red)**

Run: `pnpm vitest run tests/sidebar-rail.test.tsx`
Expected: PASS actually — removal of assertions can't fail. This task is deletion-driven, so the "red" signal is the source still containing the dead code. Verify it does:

Run: `grep -c "runPageAgentQuickAction" src/lib/quick-actions.ts src/components/SidebarRail.tsx`
Expected: nonzero counts in both files.

- [ ] **Step 3: Remove the quick action from `src/lib/quick-actions.ts`**

Delete the constant (line ~31):

```typescript
const PAGE_AGENT_VISIBLE_KEY = "pageAgent.visible"
```

Delete the entire function and its doc comment (lines ~192–222):

```typescript
/**
 * Hide/show the page-agent launcher globally. Content scripts listen to the
 * stored visibility flag, so this works even when the active tab cannot receive
 * extension messages.
 */
export async function runPageAgentQuickAction(): Promise<QuickActionResult> {
  const result = await chrome.storage.local.get(PAGE_AGENT_VISIBLE_KEY)
  const current =
    typeof result?.[PAGE_AGENT_VISIBLE_KEY] === "boolean"
      ? result[PAGE_AGENT_VISIBLE_KEY]
      : true
  const visible = !current
  await chrome.storage.local.set({ [PAGE_AGENT_VISIBLE_KEY]: visible })

  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ["normal"] })
    if (win?.id) {
      const [tab] = await chrome.tabs.query({ active: true, windowId: win.id })
      if (tab?.id) {
        await chrome.tabs.sendMessage(tab.id, {
          type: "PAGE_AGENT_TOGGLE",
          visible
        })
      }
    }
  } catch {
    // The storage flag is the source of truth; messaging is only an immediate
    // refresh for tabs that already have the content script loaded.
  }
  return { kind: "success", message: visible ? "Page agent shown" : "Page agent hidden" }
}
```

- [ ] **Step 4: Remove the rail entry from `src/components/SidebarRail.tsx`**

In the import from `../lib/quick-actions` (top of file), remove the `runPageAgentQuickAction,` line:

```typescript
// OLD:
import {
  runPageAgentQuickAction,
  runPipQuickAction,
  type QuickActionResult,
  runSaveLinkQuickAction,
  runScreenshotQuickAction,
  runFullPagePdfQuickAction
} from "../lib/quick-actions"

// NEW:
import {
  runPipQuickAction,
  type QuickActionResult,
  runSaveLinkQuickAction,
  runScreenshotQuickAction,
  runFullPagePdfQuickAction
} from "../lib/quick-actions"
```

In the `QUICK_ACTIONS` array (line ~58), delete this entry:

```typescript
  { label: "Page agent", icon: "cloud", run: runPageAgentQuickAction },
```

- [ ] **Step 5: Run the affected tests**

Run: `pnpm vitest run tests/sidebar-rail.test.tsx tests/rail-icons.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/quick-actions.ts src/components/SidebarRail.tsx tests/sidebar-rail.test.tsx tests/page-agent-ui.test.ts
git commit -m "Remove page agent quick action from the rail"
```

(`SidebarRail.tsx` has unrelated dirty hunks — see the dirty-tree warning in the header. Stage with `git add -p` if you need to exclude them, or get user sign-off.)

---

### Task 2: Delete the overlay content script

**Files:**
- Delete: `src/contents/page-agent.ts`
- Modify: `tests/extension-privacy.test.ts`

- [ ] **Step 1: Remove the privacy-test references to the deleted file**

In `tests/extension-privacy.test.ts`, inside the test `"does not inject extension-branded DOM markers into web pages"`, delete the read:

```typescript
    const pageAgentSource = readFileSync(
      join(process.cwd(), "src/contents/page-agent.ts"),
      "utf8",
    );
```

and the two assertions:

```typescript
    expect(pageAgentSource).not.toContain("data-ai-dev");
    expect(pageAgentSource).not.toContain("alexometer");
```

- [ ] **Step 2: Delete the content script**

```bash
git rm src/contents/page-agent.ts
```

Plasmo registers content scripts by file presence in `src/contents/`, so deleting the file unregisters it — no manifest edit needed.

- [ ] **Step 3: Verify no dangling references**

Run: `grep -rn "page-agent\|PAGE_AGENT_TOGGLE\|pageAgent\." src/ --include="*.ts" --include="*.tsx" | grep -v background.ts | grep -v page-agent-program`
Expected: no output. (background.ts and page-agent-program are handled in Task 3.)

Run: `pnpm vitest run tests/extension-privacy.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/contents/page-agent.ts tests/extension-privacy.test.ts
git commit -m "Delete page agent overlay content script"
```

---

### Task 3: Delete the planner and background wiring

This removes the page-agent message handlers, the Foundation Models plan call, the Hindsight client, the program executor module, and the cloud-payload helper whose only consumer is the deleted handler.

**Files:**
- Modify: `src/background.ts`
- Delete: `src/background/page-agent-program.ts`
- Delete: `src/lib/browser-agent-cloud.ts`
- Delete: `tests/page-agent-program.test.ts`, `tests/page-agent-step.test.ts`, `tests/browser-agent-cloud.test.ts`

**Pre-check (important):** `src/lib/ai-rename.ts` and `src/components/SettingsPanel.tsx` use the `browserAgentCloud*` **settings fields** directly — they do NOT import `src/lib/browser-agent-cloud.ts`. The settings fields and UI toggles stay. Only the lib file and its test are deleted. Verify before deleting:

Run: `grep -rn "browser-agent-cloud" src/ --include="*.ts" --include="*.tsx"`
Expected: only `src/background.ts` (the import being removed in this task).

- [ ] **Step 1: Delete the obsolete test files**

```bash
git rm tests/page-agent-program.test.ts tests/page-agent-step.test.ts tests/browser-agent-cloud.test.ts
```

- [ ] **Step 2: Remove the message-listener blocks in `src/background.ts`**

Inside the `chrome.runtime.onMessage` listener (lines ~924–960), delete both blocks:

```typescript
  if (message.type === "PAGE_AGENT_OBSERVE") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId unavailable" });
      return;
    }
    pageAgentObserve(tabId)
      .then((observation) => sendResponse({ ok: true, observation }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }

  if (message.type === "PAGE_AGENT_MESSAGE") {
    const tabId = sender.tab?.id;
    if (typeof tabId !== "number") {
      sendResponse({ ok: false, error: "tabId unavailable" });
      return;
    }
    handlePageAgentMessage({
      tabId,
      sessionId: typeof message.sessionId === "string" ? message.sessionId : undefined,
      text: String(message.text || ""),
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return true;
  }
```

- [ ] **Step 3: Remove the page-agent implementation in `src/background.ts`**

Delete everything from `async function pageAgentObserve` (line ~1330) through the closing brace of `handlePageAgentMessage` (line ~1523) — that is: `pageAgentObserve`, the `LocalPlanResponse` type, the `hindsightClient`/`hindsightBankId` constants, and the whole `handlePageAgentMessage` function. The block starts at:

```typescript
async function pageAgentObserve(tabId: number): Promise<unknown> {
```

and ends at (the line immediately before `async function resolveHostname`):

```typescript
  return {
    sessionId,
    reply,
    provider: localPlan?.ok ? "foundation-models" : "local-deterministic",
    steps: trace.steps
  };
}
```

- [ ] **Step 4: Remove the now-dead imports in `src/background.ts`**

Line 2:

```typescript
import { HindsightClient } from "@vectorize-io/hindsight-client";
```

Line ~13:

```typescript
import { buildBrowserAgentCloudChatPayload } from "./lib/browser-agent-cloud";
```

Lines ~84–88:

```typescript
import {
  parseProgram,
  executeProgram,
  type ProgramDeps,
  type StepEntry
} from "./background/page-agent-program";
```

- [ ] **Step 5: Delete the orphaned modules**

```bash
git rm src/background/page-agent-program.ts src/lib/browser-agent-cloud.ts
```

- [ ] **Step 6: Type-check and fix any leftovers**

Run: `npx tsc --noEmit`
Expected: PASS. If it reports other now-unused imports in `background.ts` (e.g. `createSidebarApiClient` or `getSettings` are used elsewhere and should NOT be removed), only remove imports the compiler actually flags as unused-and-erroring; this codebase doesn't error on unused imports by default, so the realistic failures are *missing* symbols — fix by confirming Steps 2–4 removed whole blocks, nothing more.

- [ ] **Step 7: Run the full test suite**

Run: `pnpm test`
Expected: PASS, with the deleted test files gone from the run. If `tests/mcp-tools-registry.test.ts`, `tests/browser-observe.test.ts`, or `tests/dom-tools-screenshot.test.ts` fail, something in this task touched the MCP tool path by mistake — it must not.

- [ ] **Step 8: Commit**

```bash
git add src/background.ts src/background/page-agent-program.ts src/lib/browser-agent-cloud.ts tests/page-agent-program.test.ts tests/page-agent-step.test.ts tests/browser-agent-cloud.test.ts
git commit -m "Remove page agent planner, Hindsight client, and cloud payload helper"
```

(`background.ts` has unrelated dirty hunks — see the dirty-tree warning; get user sign-off or stage with `git add -p`.)

---

### Task 4: Drop the Hindsight dependency

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Verify the dependency is now unused**

Run: `grep -rn "hindsight" src/ native-host/*.mjs scripts/`
Expected: no output. If anything still imports it, STOP and report — do not remove the dependency.

- [ ] **Step 2: Remove it**

```bash
pnpm remove @vectorize-io/hindsight-client
```

- [ ] **Step 3: Confirm the build still type-checks**

Run: `npx tsc --noEmit`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Drop unused hindsight-client dependency"
```

(`package.json` has unrelated dirty hunks — same drill as before.)

---

### Task 5: Bridge timeout bump and clearer no-tab error

Two small robustness fixes from the spec. TDD applies to the error-message change.

**Files:**
- Modify: `native-host/ai-dev-host.mjs` (lines ~44–50)
- Modify: `src/background/dom-tools.ts` (line ~27)
- Test: `tests/native-host-bridge.test.ts` or `tests/mcp-http-integration.test.ts` (check which covers the bridge timeout; if neither asserts the timeout value, skip writing a new test for the constant — it's config, not logic)

- [ ] **Step 1: Check for existing assertions on the old values**

Run: `grep -rn "timed out (15s)\|15_000\|NO_TAB_ERR\|no active tab" tests/`
Expected: the only `15_000` hit is `tests/terminal-keepalive.test.ts` (unrelated — keepalive interval, leave it). If any test pins the bridge timeout or the no-tab message, update it in the same edit as the source change below.

- [ ] **Step 2: Bump the bridge timeout in `native-host/ai-dev-host.mjs`**

```javascript
// OLD:
    setTimeout(() => {
      if (pendingToolCalls.delete(id)) {
        reject(new Error(`tool ${name} timed out (15s)`))
      }
    }, 15_000)

// NEW:
    setTimeout(() => {
      if (pendingToolCalls.delete(id)) {
        reject(new Error(`tool ${name} timed out (30s)`))
      }
    }, 30_000)
```

Rationale: `navigate` waits up to 10s for tab load (and accepts `timeoutMs` up to 30s), then runs a full observation — 15s end-to-end is too tight for slow pages.

- [ ] **Step 3: Clarify the no-tab error in `src/background/dom-tools.ts`**

```typescript
// OLD:
const NO_TAB_ERR = "no active tab; pass tabId explicitly"

// NEW:
const NO_TAB_ERR =
  "no usable active tab (it may be a restricted browser page like chrome:// or about:); use tabs_list and pass tabId explicitly"
```

- [ ] **Step 4: Run the relevant tests**

Run: `pnpm vitest run tests/native-host-bridge.test.ts tests/mcp-http-integration.test.ts tests/browser-observe.test.ts tests/dom-tools-screenshot.test.ts`
Expected: PASS. A failure here means a test pinned one of the old strings — update it to the new string, not the other way around.

- [ ] **Step 5: Commit**

```bash
git add native-host/ai-dev-host.mjs src/background/dom-tools.ts
git commit -m "Bump MCP bridge timeout to 30s and clarify no-tab error"
```

(`native-host/ai-dev-host.mjs` has unrelated dirty hunks — same drill.)

---

### Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite**

Run: `pnpm test`
Expected: PASS, zero references to deleted files in the output.

- [ ] **Step 2: Production build**

Run: `pnpm build`
Expected: completes; the built manifest no longer lists a content script for `page-agent`.

- [ ] **Step 3: Dead-reference sweep**

Run: `grep -rn "PAGE_AGENT\|pageAgent\|page-agent\|handlePageAgentMessage\|hindsight" src/ tests/ --include="*.ts" --include="*.tsx" -i`
Expected: no output.

- [ ] **Step 4: Manual end-to-end from Claude Code (requires the user's browser)**

With the rebuilt extension loaded and the native host running, from a Claude Code session (the `ai-dev-sidebar` MCP server should already be registered in `~/.claude.json`):

1. Call `tabs_list` — expect a JSON array of open tabs.
2. Call `browser_observe` with no args — expect an observation of the active tab with `nodes`, `limits`, and `url`.
3. Navigate the active tab to `https://example.com`, then call `click` with `selector: "a"` — expect a click result plus a fresh observation showing the IANA page.

This is a user-assisted step: ask the user to run it (or run it if you are a Claude Code session connected to that MCP server).

- [ ] **Step 5: Note the follow-up**

The `foundationModels.plan` case in `native-host/ai-dev-host.mjs` (line ~723) is now likely orphaned — `foundationModels.chat` and `foundationModels.compact` are still used by `src/background/native-host-bridge.ts`, so the Swift bridge stays. Per the spec, deleting the orphaned `.plan` case is a follow-up, not part of this change. Mention it in the final report.
