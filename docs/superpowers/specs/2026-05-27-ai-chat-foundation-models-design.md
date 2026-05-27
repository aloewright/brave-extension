# AI Chat — Foundation Models Tool-Calling Loop (Design)

**Status:** Approved 2026-05-27.
**Author:** Claude, paired with project owner.
**Scope:** `ai-dev-sidebar` (Brave/Chromium MV3 extension, Plasmo, TypeScript + React) + a new `chat` operation in `native-host/foundation-models-bridge.swift`.

## Goal

Add a conversational AI chat to the Brave sidebar, powered by Apple's Foundation Models running locally via the existing `native-host/foundation-models-bridge.swift`. The chat supports tool calling: the model can invoke a small registry of tools (initially: Joplin note create, Joplin ping, active-tab context) and the results thread back into the conversation. The chat is the first user-visible piece of the larger "drive the app via Foundation Models" effort; further sub-projects (richer Joplin tool layer, heartbeat, workflows, planner) build on this MVP.

This spec implements **S2 — AI chat UI + tool-calling loop**, decomposed from a larger 5-subsystem ask:

- S1 — Joplin tool layer expansion (later)
- **S2 — AI chat UI + tool-calling loop (this spec)**
- S3 — Heartbeat / context file (later)
- S4 — Workflows / hooks (later)
- S5 — Planner (later)

"Create endpoints if they don't exist" is interpreted as composing new operations on top of Joplin's existing REST API (we can't fork Joplin). All such composites live in the future S1 tool layer; this spec ships with only the three tools defined below.

## Locked decisions

| Decision | Value | Why |
|---|---|---|
| Chat experience | Conversational with tool-results inline (multi-turn per user Send) | Like ChatGPT with tool use. Model picks tools, results thread back, model continues or asks for confirmation. |
| Confirmation policy | Auto-fire all tools; hard Stop button | Speed over safety; cooperative cancellation through a flag checked between loop iterations. |
| Persistence | Single rolling conversation in `@plasmohq/storage` | Survives reloads, simple mental model, one Clear button. |
| Ambient context | Thin slice: active tab URL+title + most recent Joplin clip, attached once per Send | Foundation for S3; doesn't commit S3's shape. |
| Orchestration loop location | Background service worker | Survives sidebar mount/unmount. Tools live in TS. Same pattern as the Joplin clipper. |
| Tool registry | Dynamic, sent on each bridge request | Bridge stays generic; tool list evolves in extension only, no Swift rebuilds. |
| Bridge streaming | None in V1 — request → wait → full response | Streaming is meaningful extra work; defer. |
| Step cap | 10 tool calls per user Send | Prevents runaway loops; emit synthetic "Hit the 10-step cap" assistant message. |
| Compaction | Best-effort, triggered after every turn when conversation > 40 messages since last head | Uses bridge's existing `compact` operation. Compacted messages stay in storage; muted banner in UI. |

## Architecture

```
                                      ┌────────────────────────────────────────────┐
  Sidebar AI Chat UI                   │  Background service worker (src/background) │
  src/sections/ai-chat/                │                                            │
  ChatSection.tsx                      │  ┌──────────────────────────────────────┐ │
  ┌──────────────────────┐             │  │ src/background/chat-orchestrator.ts  │ │
  │ Messages list        │             │  │                                      │ │
  │ Input box + Send     │── msg ────► │  │  loop per user message:              │ │
  │ Stop button          │             │  │    build prompt:                     │ │
  │ Tool call cards      │             │  │      system + tools schema +         │ │
  │   (auto-firing,      │             │  │      ambient context (tab, last clip)│ │
  │    inline results)   │             │  │      + history                       │ │
  └──────────────────────┘             │  │    → bridge.chat(prompt, tools)      │ │
            ▲                          │  │    → if response.toolCall:           │ │
            │ chrome.runtime           │  │        execute via registry          │ │
            │ broadcast                │  │        append tool result            │ │
            │  • ai-chat/turn-update   │  │        loop                          │ │
            │  • ai-chat/turn-done     │  │      else:                           │ │
            │                          │  │        emit final reply              │ │
            ▼                          │  └──────────────────────────────────────┘ │
  src/lib/ai-chat-store.ts             │             │             │              │
  (rolling conversation in storage)    │             ▼             ▼              │
                                       │  src/lib/ai-chat-       src/lib/         │
                                       │  tools.ts (registry)    joplin-client.ts │
                                       │  + tool implementations + future tools   │
                                       └──────┬──────────────────────────────────┘
                                              │ chrome.runtime.sendNativeMessage
                                              ▼
                                       native-host (ai-dev-host.mjs)
                                              │
                                              │ child_process: swift run …
                                              ▼
                                       foundation-models-bridge.swift
                                       (new "chat" operation with
                                        @Generable ChatTurnResponse)
                                              │
                                              ▼
                                       SystemLanguageModel (Apple, on-device)
```

The sidebar UI and the orchestrator communicate only through `chrome.runtime` messages and storage. Storage is the source of truth; broadcasts are the fast path. A sidebar that mounts mid-turn hydrates from storage and then appends broadcasts.

## Data model

All types in `src/lib/ai-chat-types.ts`.

### Messages and conversation

```ts
export type ChatRole = "user" | "assistant" | "tool" | "system"

export interface ChatMessage {
  id: string                  // ulid()
  role: ChatRole
  content: string             // user text, assistant prose, or JSON-encoded tool result
  toolCall?: ToolCall         // present on assistant messages that emitted one
  toolCallId?: string         // present on tool messages — the toolCall.id they answer
  toolError?: string          // present on tool messages that errored
  ambient?: AmbientContext    // present on user messages — what state we attached
  turnId: string              // groups user + N tool round-trips + assistant for one Send
  createdAt: string           // ISO timestamp
}

export interface ToolCall {
  id: string                  // ulid() — matches tool messages back to the assistant call
  name: string                // e.g. "joplin.createNote"
  arguments: Record<string, unknown>  // parsed from argumentsRaw
  argumentsRaw: string        // exact JSON the model emitted
}

export interface AmbientContext {
  activeTab?: { url: string; title: string }
  mostRecentClip?: { title: string; mode: string; createdAt: string; joplinUrl: string }
}

export interface Conversation {
  messages: ChatMessage[]     // append-only at runtime
  compactedHead?: { summary: string; truncatedThrough: string /* last message id covered */ }
}
```

### Tool registry

```ts
export interface ToolDefinition {
  name: string                // dotted namespace: "joplin.createNote", "context.activeTab"
  description: string         // one-sentence; goes into the model prompt
  parametersSchema: JSONSchema // JSON Schema describing arguments shape
  execute(args: Record<string, unknown>): Promise<ToolExecutionResult>
}

export type JSONSchema = Record<string, unknown>

export interface ToolExecutionResult {
  ok: boolean
  result?: unknown            // JSON-stringified into the next-turn prompt
  error?: string              // present when ok === false
}
```

### Message-bus events

```ts
export interface ChatSendRequest {
  type: "ai-chat/send"
  userMessageId: string       // pre-generated by sidebar for optimistic render
  text: string
  ambient: AmbientContext
}

export interface ChatStopRequest {
  type: "ai-chat/stop"
  turnId: string
}

export interface ChatTurnUpdateEvent {
  type: "ai-chat/turn-update"
  turnId: string
  appendedMessage: ChatMessage
}

export interface ChatTurnDoneEvent {
  type: "ai-chat/turn-done"
  turnId: string
  reason: "final" | "stopped" | "step-cap" | "error"
  errorMessage?: string
}
```

### Bridge protocol (new `chat` operation)

Native-host (TS) → Swift bridge stdin:

```ts
export interface BridgeChatRequest {
  operation: "chat"
  systemPrompt: string         // host-built (tool catalog + ambient + compaction head)
  history: BridgeChatMessage[]
  toolsJson: string            // JSON Schema array of available tools
}

export interface BridgeChatMessage {
  role: "user" | "assistant" | "tool"
  content: string
  toolName?: string
  toolArguments?: string
  toolError?: string
}
```

Bridge response (Swift `@Generable`):

```swift
@Generable
struct ChatTurnResponse: Codable {
    @Guide(description: "If you have everything you need to reply to the user, put your final assistant message here. Otherwise leave nil and use toolCall.")
    var final: String?

    @Guide(description: "If you need a tool, set this to call exactly one tool. Otherwise leave nil and use `final`.")
    var toolCall: ChatToolCall?
}

@Generable
struct ChatToolCall: Codable {
    @Guide(description: "Tool name exactly as listed in the available tools.")
    var name: String

    @Guide(description: "JSON-encoded arguments matching the tool's schema. Use {} when no args.")
    var arguments: String
}
```

The existing `BridgeResponse` envelope gains an optional `chatTurn: ChatTurnResponse?` field. Orchestrator validates `final` XOR `toolCall` on the TS side (defensive — see Error handling case 11).

### Storage layout

| Key | Type | Notes |
|---|---|---|
| `ai-dev-ai-chat-conversation` (new) | `Conversation` | Single rolling thread. Compacted in-place when > 40 messages since last head. |

## Components

### New files

| File | Responsibility |
|---|---|
| `src/lib/ai-chat-types.ts` | Shared types (above). Imported by every other module. |
| `src/lib/ai-chat-store.ts` | `getConversation`, `appendMessage`, `updateMessage`, `clearConversation`, `setCompactedHead`. Pure async, no chrome.\* / no React. |
| `src/lib/ai-chat-tools.ts` | `buildTools(getToken)` returns the V1 catalog (joplin.createNote, joplin.ping, context.activeTab). `runTool(tools, name, argumentsJson)` validates + executes. `captureAmbient()` reads active tab + most recent clip. |
| `src/background/chat-orchestrator.ts` | `runChatTurn({userMessageId, text, ambient})`. The loop: build prompt → bridge → tool call → loop. `stopTurn(turnId)` sets a cancel flag. Module-level state: `activeTurns: Map<turnId, AbortController>`, `cancelledTurns: Set<turnId>`. |
| `src/background/native-host-bridge.ts` | `runFoundationModelsChat(input, opts)` and `runFoundationModelsCompact(input)` — thin promise wrappers over `chrome.runtime.sendNativeMessage`. Builds the bridge system prompt via `buildSystemPrompt(compactedHead, tools, ambient)` and the history via `toBridgeHistory(message)`. |
| `src/sections/ai-chat/ChatSection.tsx` | Sidebar React component. Header + status dot + Clear button; messages list (virtualized via `@tanstack/react-virtual`); composer with Send + Stop; listens for `ai-chat/turn-*` broadcasts. |

### Edited files

| File | Change |
|---|---|
| `src/background.ts` | Add a `chrome.runtime.onMessage` listener arm for `ai-chat/send` and `ai-chat/stop`. Dispatches to `chat-orchestrator`. |
| `src/sections/types.ts` | Add `"aiChat"` to `SectionId` union and `{ id: "aiChat", label: "AI Chat" }` to `SECTIONS`. |
| `src/sidepanel.tsx` | Import `ChatSection`, add `{active === "aiChat" && <ChatSection />}` to the render switch. |
| `src/components/SidebarRail.tsx` | Add `aiChat: "<icon-name>"` to `ICONS` (the `Record<SectionId, LeoIconName>` requires completeness). Suggested: `"sparkle"` or `"chat"` — pick the project's closest available. |
| `tests/e2e/sidepanel-rail.spec.ts` | Add `aiChat: "AI Chat"` to `SECTION_LABELS`. |
| `native-host/foundation-models-bridge.swift` | Add a new `case "chat":` branch in the operation dispatch. Adds `var chatTurn: ChatTurnResponse?` to `BridgeResponse`. Adds `ChatTurnResponse` and `ChatToolCall` `@Generable` structs. Adds `makeChatPrompt(request:)` helper mirroring `makePlanPrompt`. |

### Tool catalog (V1, in `ai-chat-tools.ts`)

Three tools, intentionally small:

| Name | Args | Behavior |
|---|---|---|
| `joplin.createNote` | `{ title: string, body: string, sourceUrl?: string }` | Calls existing `createNote` from `joplin-client.ts`. Returns `{ id: <joplin note id> }` or error. |
| `joplin.ping` | `{}` | Calls existing `ping()`. Returns `{ reachable: boolean }`. |
| `context.activeTab` | `{}` | `chrome.tabs.query({ active: true, lastFocusedWindow: true })`. Returns `{ url, title }` or `{ url: null, title: null }`. |

The `getToken` factory parameter on `buildTools` lets the orchestrator inject `getSettings().joplinToken` without making `ai-chat-tools.ts` depend on background-side modules.

### Stop mechanics + step cap

`stopTurn(turnId)` adds the id to `cancelledTurns`. The orchestrator checks the flag **at two points per loop iteration**: before the bridge call and after it. A bridge call already in flight gets `AbortController.signal` but neither `chrome.runtime.sendNativeMessage` nor the underlying Swift subprocess respond to abort signals — the call completes, its result is dropped before persistence. A tool call mid-execution is **not aborted** (partial state would be worse than a few seconds of slow stop). So "Stop" can take up to (one bridge call + one tool call) of latency to take effect — typically <2s.

Step cap: `STEP_CAP = 10` tool calls per user Send. On hit, orchestrator appends a synthetic assistant message ("Hit the 10-step cap. Send another message to continue.") and broadcasts `turn-done { reason: "step-cap" }`.

## Data flow

### Entry — user Send

```
ChatSection.onSend()
  ├─ userMessageId = ulid()
  ├─ ambient = captureAmbient()   // chrome.tabs.query + most-recent-clip
  ▼
chrome.runtime.sendMessage(ChatSendRequest)
  ▼
background.ts → runChatTurn({ userMessageId, text, ambient })
```

### Pipeline (inside background)

```
runChatTurn(input)
  ├─ allocate turnId = ulid()
  ├─ activeTurns.set(turnId, AbortController)
  │
  ├─ append user message + broadcast
  │
  ├─ resolve tools (with getToken) + read settings.joplinToken
  │
  └─ loop (≤ STEP_CAP iterations)
        ├─ check cancellation → if cancelled, emit "Stopped by user"
        ├─ load conversation, trim past compactedHead
        ├─ runFoundationModelsChat({compactedHead, history, tools, ambient})
        │     └─ sendNativeMessage("ai_dev_host", {operation: "chat", ...})
        │        spawns Swift bridge subprocess
        │        SystemLanguageModel.respond(generating: ChatTurnResponse.self)
        ├─ check cancellation again
        ├─ branch on response:
        │   (A) final present → append assistant final, turn-done(final), exit
        │   (B) toolCall present → append assistant-tool-call, runTool, append tool result, broadcast each, steps += 1, continue
        │   (C) neither → turn-done(error), exit
        │   (defensive: both present → prefer toolCall, log warning)
        └─ if STEP_CAP hit → synthetic message + turn-done(step-cap)

finally:
  activeTurns.delete(turnId)
  cancelledTurns.delete(turnId)
  void maybeCompact()   // best-effort
```

### Exit reasons

| Reason | Trigger | Final message in conversation |
|---|---|---|
| `final` | Bridge returned `chatTurn.final` non-empty | Assistant's reply (the model's content). |
| `stopped` | `stopTurn(turnId)` flagged the turn | Synthetic: "Stopped by user." |
| `step-cap` | 10 tool calls executed without a `final` | Synthetic: "Hit the 10-step cap. Send another message to continue." |
| `error` | Bridge unreachable, response malformed, abort triggered, exception thrown | No final message appended; `turn-done` carries `errorMessage` for the UI. |

### Sidebar reception

```
ChatSection useEffect listener:
  on "ai-chat/turn-update":
    setMessages(prev => [...prev, appendedMessage])
    if (!turnInFlight) setTurnInFlight(turnId)
  on "ai-chat/turn-done":
    setTurnInFlight(null)
    if (event.reason === "error"): show inline banner with errorMessage
```

A sidebar mounting mid-turn calls `getConversation()` and renders all persisted messages, then appends from broadcasts.

### Compaction

`maybeCompact()` runs in `finally` after every turn. Heuristic:

- Count messages since last compactedHead.
- If `< 40`, skip.
- Otherwise take the oldest `floor(N/2)` messages, serialize as `role: content` lines, truncate to 6000 chars, send to bridge `compact` op.
- Store returned `compactSummary` and the id of the last covered message in `conversation.compactedHead`.
- Compaction failure is swallowed; next turn retries.
- UI shows muted "Compacted earlier turns: …" banner when `compactedHead` is set.

## Concurrency model

**One turn at a time, globally.** Send button is the only gate; `runChatTurn` itself doesn't gate (future callers — workflows, planner — are responsible for their own serialization).

| Boundary | Mechanism |
|---|---|
| Sidebar ↔ background | `chrome.runtime` messages only. Two outgoing (`ai-chat/send`, `ai-chat/stop`), two incoming (`ai-chat/turn-update`, `ai-chat/turn-done`). |
| Background ↔ storage | `@plasmohq/storage`; writes are sequential within a turn via `await`. Across turns, only one turn runs at a time. |
| Background ↔ native host | `chrome.runtime.sendNativeMessage` resolves with full bridge response. One pending call per turn. Each call spawns a fresh Swift subprocess. |
| Cancellation | `AbortController` passed into `sendNativeMessage` wrapper. The wrapper rejects on `signal.abort` but the underlying chrome API and the Swift subprocess complete; their result is dropped. |

**Reentry cases:**

- Sidebar mounts mid-turn → hydrates from storage, appends from broadcasts. No turn loss.
- Sidebar unmounts mid-turn → orchestrator keeps running; messages keep being persisted.
- **Background SW restart mid-turn (MV3 eviction):** in-memory `activeTurns` is lost; the in-flight bridge call is lost; conversation reflects only what was already appended. UI appears stuck with `turnInFlight !== null`. Mitigation: sidebar starts a **60-second client-side timeout** from the last `turn-update`; if `turn-done` doesn't arrive, the sidebar synthesizes `turn-done { reason: "error", errorMessage: "Turn lost — background may have restarted. Send again." }`, local-only (no storage write), and clears `turnInFlight`.
- Two sidebars open at once (multi-window Brave) → both receive the same broadcasts, both hydrate from the same storage. Send from either writes to the same conversation. Acceptable.

`maybeCompact()` runs detached (no `await` from the caller's perspective) because:
- It's best-effort.
- A slow compaction call shouldn't delay the next user Send.
- Its writes target `compactedHead`, a different field from append-only `messages[]`.

## Error handling

| Category | Trigger | Surface | Log level |
|---|---|---|---|
| Foundation Models unavailable | Bridge returns `ok:false, available:false` | Red status dot. Inline assistant message: "Foundation Models is unavailable on this device: \<reason\>. Check System Settings → Apple Intelligence." | `warn` |
| Native host not installed | `chrome.runtime.lastError` mentions missing host | Red status dot. Inline assistant message: "Native host not installed. Run `pnpm install-host` from the repo." | `error` |
| Bridge timeout | No response within 30s | `turn-done { reason: "error" }` with timeout message | `warn` |
| Bridge response malformed | Missing `chatTurn`, or both `final`+`toolCall`, or `toolCall.arguments` not a string | `turn-done { reason: "error" }` with shape message; if both `final`+`toolCall`, prefer `toolCall` and log warning (continue loop instead of erroring out) | `error` for missing; `warn` for both-present |
| Tool execution failure | Tool's `execute()` throws or returns `ok:false` | Tool message appended with `toolError`. Loop continues — model sees the error and recovers. | `warn` |
| Sidebar timeout (no `turn-done`) | 60s since last `turn-update` while `turnInFlight !== null` | Sidebar-synthesized `turn-done { reason: "error" }` with "Turn lost…" message. Local-only. | `warn` (sidebar console) |

### Token handling

- Read fresh per turn via `getSettings()`.
- Never sent to the bridge — Foundation Models doesn't need it; only tool implementations do.
- Never logged.
- Tool implementations URL-encode the token (existing `joplin-client.ts` pattern).
- The token never appears in any `ChatMessage.content`, `toolCall.argumentsRaw`, or broadcast.

### Observability

`console.{info,warn,error}` with `[ai-chat]` prefix and category tag:

- `[ai-chat:orchestrator]` — turn lifecycle, step count, reason, bridge timing.
- `[ai-chat:bridge]` — request/response shapes (no token, no full bodies — types and lengths).
- `[ai-chat:tool]` — name, args size in chars, success/failure, latency.

Per-message persistence at `debug`, off by default. Logs are local-only (no external shipping).

### Edge cases

1. Empty user message — `onSend` guards on `!draft.trim()`.
2. Unknown tool name — `runTool` returns `{ ok: false, error: "Unknown tool: <name>" }`; tool message has error; model corrects on next iteration.
3. Invalid JSON in `toolCall.arguments` — `safeParse` returns `{}`; `runTool` re-parses defensively; if invalid, returns parse error in `toolError`.
4. JSON Schema violation in args — V1 does **not** validate against schema. `execute()` produces a runtime error; surfaces as `toolError`. Schema validation is a future enhancement.
5. `final: ""` (empty string) — treated as a final assistant message with empty content. Blank bubble. Documented.
6. No tools available — system prompt's tools catalog is empty; model produces a `final`. No error.
7. Joplin token unset — `createNote` throws; tool message has `toolError`. Model can respond appropriately.
8. No active tab — `captureAmbient` returns ambient with `activeTab: undefined`; system prompt omits the line. `context.activeTab` returns `{ url: null, title: null }`.
9. Compaction failure — swallowed; conversation stays uncompacted; eventually hits bridge context limit (error category 4).
10. User clears conversation mid-turn — gated on `!turnInFlight` in the UI; can't happen via normal use.
11. Both `final` and `toolCall` in response — prefer `toolCall`, log warning, continue loop. (Loops are more recoverable than dropping actions.)
12. Bridge `contextSize` is `nil` — compaction trigger uses the `> 40 messages` criterion as primary; contextSize check is secondary when available.
13. Identical consecutive tool calls — no special detection. Step cap is the safety net. Duplicate detection is a future enhancement.

## Testing

Vitest already wired (`pnpm test`). Project test dir is `tests/`, not co-located.

### New test files: 4, ~350–500 lines total

**`tests/ai-chat-store.test.ts`** — storage helpers with `@plasmohq/storage` mocked via in-memory Map shim (matches `tests/joplin-recents.test.ts` pattern). Tests: empty cold-start; append round-trip; updateMessage patch + no-op for unknown id; clearConversation; setCompactedHead round-trip and preservation of messages.

**`tests/ai-chat-tools.test.ts`** — stubs `chrome.tabs.query`, `chrome.storage`, joplin-client. Tests: registry has exactly the three V1 tools by name; each tool's success and error paths; runTool unknown name + malformed JSON; captureAmbient activeTab present/absent and mostRecentClip present/absent.

**`tests/ai-chat-orchestrator.test.ts`** — mocks `runFoundationModelsChat` / `runFoundationModelsCompact` from `native-host-bridge.ts` via `vi.mock`. Mocks `chrome.runtime.sendMessage` to capture broadcasts. Mocks tools-registry via `vi.mock` of `../src/lib/ai-chat-tools` for the orchestrator-specific tests. Tests cover: happy-path final reply; tool-call loop (1 round-trip then final); multiple tool calls; step cap; stop mid-loop; bridge throw → turn-done(error); malformed response; both-fields-present → prefer toolCall; tool execution failure surfaces as toolError; user message persists before any bridge call; ambient context reused across loop iterations; maybeCompact fires at >40 messages; maybeCompact swallows errors.

**`tests/native-host-bridge.test.ts`** — pure logic for `buildSystemPrompt` and `toBridgeHistory`. Tests: tools listed; ambient block present/absent; compacted head present/absent; toBridgeHistory maps user/assistant-tool-call/tool-result roles preserving `argumentsRaw` and `toolError`.

### What we explicitly do NOT test

- Foundation Models itself (black box).
- Real native host integration (manual smoke; needs Apple Intelligence on the dev box).
- Real Joplin server integration (covered by existing joplin-client tests).
- `ChatSection.tsx` React rendering (no testing-library config; passive view over event stream — bugs that matter live in the orchestrator).
- MV3 SW eviction recovery (can't reliably simulate; the 60s sidebar timeout is exercised by reading the code).

## Done-criteria checklist (for the README addition / manual smoke test)

- [ ] `pnpm build` produces a clean Plasmo bundle. The chat section's compiled JS exists under `build/chrome-mv3-prod/`.
- [ ] `pnpm test` (vitest) is green, including the four new chat test files.
- [ ] Native host installed (`pnpm install-host`); `pnpm diagnose-host` exits 0.
- [ ] Load `build/chrome-mv3-prod/` unpacked in Brave → sidebar shows the new "AI Chat" section.
- [ ] On a Mac with Apple Intelligence enabled (macOS 26+, M-series), sending a short prompt produces a response within ~5s.
- [ ] "What's the URL of my current tab?" → model emits `context.activeTab` tool call → tool result row → final assistant message naming the URL.
- [ ] "Create a Joplin note titled Hello with body World" (Joplin token configured, Web Clipper enabled) → model emits `joplin.createNote` → tool result has the note id → final assistant message confirms; verify in Joplin Desktop.
- [ ] Stop button mid-turn → within ~3s the conversation gets "Stopped by user." and `turnInFlight` clears.
- [ ] Clear button empties the conversation; sending again starts fresh.
- [ ] Apple Intelligence disabled (or Intel Mac) → first Send produces "Foundation Models is unavailable…" within ~2s.
- [ ] `pnpm uninstall-host`, reload extension → first Send produces "Native host not installed…" within ~2s.
- [ ] Force the step cap (e.g., "keep pinging Joplin forever") → after 10 calls, the cap message appears and `turn-done(step-cap)` fires.

## Known limitations carried forward

1. **No streaming.** Each bridge call is request → wait → full response. Token-by-token streaming is a future enhancement.
2. **No JSON Schema validation of tool arguments.** Args go straight to `execute()`; schema violations surface as runtime errors. Future enhancement.
3. **No duplicate-tool-call detection.** Step cap is the safety net.
4. **No mid-turn ambient refresh.** Ambient is captured once at Send; model uses `context.activeTab` to re-fetch if needed.
5. **No conversation export.** Single Clear button; no save/share affordances.
6. **No multiple conversations.** One rolling thread; deliberate per the locked decision.
7. **SW eviction recovery is timeout-based, not state-based.** A turn lost to eviction shows up as a generic "Turn lost" error after 60s; no recovery affordance.
8. **Tool catalog is minimal in V1.** Three tools. S1 (Joplin tool layer expansion) is the natural follow-on.

## File-level deliverables

```
ai-dev-sidebar/
├── src/
│   ├── background.ts                          ← + ai-chat/send + ai-chat/stop handlers
│   ├── background/
│   │   ├── chat-orchestrator.ts               (new)
│   │   └── native-host-bridge.ts              (new)
│   ├── lib/
│   │   ├── ai-chat-types.ts                   (new)
│   │   ├── ai-chat-store.ts                   (new)
│   │   └── ai-chat-tools.ts                   (new)
│   ├── sections/
│   │   ├── ai-chat/
│   │   │   └── ChatSection.tsx                (new)
│   │   └── types.ts                           ← + "aiChat" SectionId + SECTIONS entry
│   ├── components/
│   │   └── SidebarRail.tsx                    ← + aiChat in ICONS
│   └── sidepanel.tsx                          ← + ChatSection render arm
├── native-host/
│   └── foundation-models-bridge.swift         ← + "chat" operation
└── tests/
    ├── ai-chat-store.test.ts                  (new)
    ├── ai-chat-tools.test.ts                  (new)
    ├── ai-chat-orchestrator.test.ts           (new)
    ├── native-host-bridge.test.ts             (new)
    └── e2e/
        └── sidepanel-rail.spec.ts             ← + aiChat in SECTION_LABELS
```
