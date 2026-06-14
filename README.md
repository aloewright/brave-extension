![Brave Dev Extension](assets/readme-banner.svg)

# Brave Dev Extension

[![Tests](https://github.com/aloewright/brave-extension/actions/workflows/test.yml/badge.svg)](https://github.com/aloewright/brave-extension/actions/workflows/test.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Brave](https://img.shields.io/badge/Brave-FB542B?logo=brave&logoColor=white)](https://brave.com/)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20Me%20a%20Coffee-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/allosaurus)

Brave Dev Extension turns Brave's side panel and new tab page into a compact
developer console. It connects browser context to local AI CLI tools, page
inspection, recording, bookmarks, history, cookies, and synced resource storage.

Built as a custom Manifest V3 extension with React, TypeScript, and a
Rolldown-Vite/Oxc build path for Brave and Chromium browsers.

## Extension Functionality

- **Sidebar rail:** persistent sections for Terminal, Inspector, Extensions,
  Library, Bookmarks, Data, Recorder, Eyedropper, GitHub, and Settings.
- **GitHub refinements:** an opt-in **GitHub** section with a master switch and
  per-feature toggles grouped by category (Global, Repository, Pull Requests,
  Issues, Write actions) that inject Refined-GitHub-style enhancements on
  `github.com`. Read/CSS tweaks plus confirm-gated write actions (e.g. quick
  repo deletion, restore file, update PR from base) that are off by default.
  Runs entirely against GitHub with no remote code; API/write features use a
  GitHub PAT resolved from Doppler (write actions need `repo`/`delete_repo`
  scopes). Token is held in session memory only, never persisted to disk.
- **Local AI terminal:** native-host backed PTY sessions for CLI tools such as
  Claude Code, Gemini, Copilot, and Codex. Terminal tabs stay alive while moving
  around the sidebar.
- **Page inspection and capture:** scrape the active page, capture selected
  references, crop screenshots, inspect technologies, discover feeds, and send
  selections into the side panel.
- **Cookies and browser data:** inspect site-scoped cookies/cache, use compact
  expand/collapse controls, apply cookie actions, and manage third-party cookie
  prompts without exposing extension data to pages.
- **Recorder:** start browser recording through Brave's native capture prompt,
  pause/resume/stop recordings, keep recent recording metadata, and mirror
  completed clips for MCP access.
- **Joplin clipper:** save the current page to Joplin Desktop in four modes
  (simplified article, full HTML, selection, URL+title) via the sidebar or
  a right-click context menu. Requires Joplin's Web Clipper *service*
  (Tools → Options → Web Clipper → Enable) but not Joplin's own browser
  extension. Token configured in Settings → Joplin.
- **AI Chat (Apple Foundation Models):** local LLM chat in the sidebar,
  powered by Apple's on-device foundation models via the native-host
  Swift bridge. Auto-fires tool calls (V1 catalog: joplin.createNote,
  joplin.ping, context.activeTab) and threads results back into the
  conversation. Hard Stop button. Single rolling conversation with
  compaction. Requires Apple Intelligence enabled (macOS 26+,
  M-series).
- **Agent chat:** the sidebar's **Agent** tab streams a conversation with the
  deployed `agent-app` Cloudflare Worker (remote LLM work, memory, and session
  storage), including a model picker and per-session history. It requires the
  Agent API URL plus a Cloudflare Access service token (client id + secret) set
  in Settings → Agent API (Cloudflare Access); without those the tab shows a
  configuration hint instead of a chat.
- **Bookmarks and history:** pull a local bookmark snapshot into the extension,
  browse bookmarks alphabetically, by favorites, or by category, and show recent
  history on the new tab page.
- **New tab workspace:** Brave Search, ordered app cards for Cloudflare, App
  Store Connect, Email, daily planner, chat, blog editor, link shortener, and
  compact utility links, plus open tabs and scrollable history panels.
- **Resource library:** save links, references, bookmarks, recordings, and PDFs
  as structured resources that can be searched locally or synced through the
  worker backend.
- **Auto picture-in-picture:** detects playable media across tabs and can move
  eligible video into picture-in-picture based on extension settings.

## Architecture

- **Extension UI:** React + TypeScript side panel, popup, content scripts, and
  new tab page packaged into `build` by `scripts/build-extension.mjs`.
- **Native host:** a Node native-messaging host bridges Brave to local shells,
  the MCP HTTP/SSE server, recorder mirrors, and local config files.
- **Worker backend:** the optional `worker/` service stores conversations,
  links, bookmarks, recordings, PDFs, and vector search metadata using
  Cloudflare Workers infrastructure.
- **Privacy boundary:** web pages talk to content scripts only through explicit
  extension messages. Extension resources, native-host tokens, and stored data
  stay in extension or native-host storage rather than being exposed to sites.

## New tab page

![New tab screenshot](assets/newtab-screenshot.png)

The extension replaces the new tab page with a Brave-style search bar, a row
of icon-only Quick Links (chat / email / calendar / tasks / link shortener),
and a draggable grid of Workspace App tiles.

### Customizing the Quick Links row

The five icon-only links under search are editable on the new tab page.
Click **Edit links** to add, remove, or change each shortcut (name, URL, and
icon). Changes persist in `chrome.storage.local` under `newtab.quickLinks`.

Defaults ship in [`src/newtab-quick-links.ts`](src/newtab-quick-links.ts)
as `DEFAULT_QUICK_LINKS`. To change the out-of-box list for new installs,
edit that array (each entry needs `id`, `label`, `url`, and an `icon` slug
from [`src/newtab-apps.ts`](src/newtab-apps.ts)).

### Customizing the Workspace App grid

The larger tile grid below the Quick Links is sourced from the
`WORKSPACE_APPS` array in [`src/newtab-apps.ts`](src/newtab-apps.ts).
Each tile has `name`, `domain`, `url`, `icon` (one of the named icon
slugs at the top of that file), and an `accent` color. Add, remove, or
re-order entries to change which apps appear; per-tab ordering can also
be rearranged by drag-and-drop and is persisted in
`chrome.storage.local`.

## Development

```sh
pnpm install
pnpm dev            # watch-builds build/ for unpacked extension reloads
pnpm build          # production build into build/
pnpm package        # build and zip build/
pnpm install-host   # install the native messaging host
pnpm diagnose-host  # print signing/quarantine state of native artifacts
pnpm typecheck      # tsc --noEmit -p .
pnpm test           # vitest run
pnpm test:coverage  # vitest + v8 coverage (60% line / 50% branch floor)
pnpm test:e2e       # playwright e2e suite
```

### macOS: "Apple could not verify '<name>' is free of malware" (ALO-472)

`pnpm install`, `pnpm install-host`, `pnpm dev`, and `pnpm build` all strip
Gatekeeper/XProtect xattrs from native addons under every repo `node_modules` tree
(root, `native-host/`, `worker/`): node-pty `.node` files, **esbuild**,
**rollup.darwin-*.node**, **fsevents.node**, **swift-manifest** (Foundation Models /
`swift` bridge), @swc/core, lightningcss, etc.
The popup's hash-prefixed filename (e.g. `.99bfbbed9bcd5adb-00000000.node` or
`.9db7f7fe3f8cd7ea-00000000.node`) is XProtect's internal scan-cache name for
node-pty's `pty.node` or `spawn-helper`.

If the popup still appears:

1. Run `pnpm rebuild-pty` — rebuilds node-pty locally, clears Gatekeeper xattrs,
   and warm-loads the real Node import path.
2. Run `pnpm diagnose-host --fix` or `pnpm scrub-native` to re-scrub all native
   artifacts if another dependency triggers a warning.
3. Reload the extension so Brave starts a fresh native host.

## Typechecking

`pnpm typecheck` runs the full TypeScript compiler in `--noEmit` mode against
`tsconfig.json`. The same command runs in the `typecheck` GitHub Actions
workflow on every PR and push to `main` (Node 22, deps installed with
`--ignore-scripts`).

The job is currently **non-blocking** (`continue-on-error: true`) — see
`ROADMAP.md` for the plan to flip it to a hard gate.

## Testing

Unit tests live in `tests/` and run on Vitest with a `happy-dom` environment.
An in-memory `chrome.storage.local` shim is installed in `tests/setup.ts`,
so storage-layer tests run without any browser/extension runtime.
Dependabot opens grouped weekly PRs (Monday 06:00 UTC). Minor/patch
updates auto-merge on green CI via
`.github/workflows/dependabot-auto-merge.yml`; majors are flagged for
human review. Triage SOP: [`docs/dependabot-triage.md`](docs/dependabot-triage.md).

### Storage / migration

Chat history is stored as per-backend shards under
`ai-dev-messages-<backend>` (one of `claude`, `gemini`, `copilot`, `codex`).
Older builds wrote a single `ai-dev-messages` array; the storage layer
migrates that legacy key into shards lazily, idempotently, and without
ever wiping history when the user switches backends mid-migration.

Cold-start reads via `getMessagesForBackend(backend)` issue a single
`chrome.storage.local.get` of the shard key. The legacy key is only
consulted on a second round-trip when the shard is missing _and_ no
`migration:ai-dev-messages:<backend>` marker is set. Once every backend
has been hydrated, the top-level `migration:ai-dev-messages-complete`
flag is set and the legacy key is dropped atomically. Migration markers
also let `getMessages()` and `setMessages()` re-run safely — repeated
calls do not double-shard or lose data
(`tests/migration.ai-dev-messages.test.ts`).

```sh
npm test          # one-shot run
npm run test:watch
```

The `tests` GitHub Actions workflow (`.github/workflows/test.yml`) runs the
same `npm test` on every pull request and on every push to `main`. CI installs
deps with `--ignore-scripts` so native scrub hooks don't fire — the
storage/types tests run in plain Node and don't need the built extension.

### Native-host integration tests

`tests/native-host.integration.test.ts` spawns `native-host/ai-dev-host.mjs`
as a child process and drives it over Chrome's length-prefixed JSON framing,
covering `exec` (with streaming stdout), `kill`, `session-status`, and
`reset-backend` round-trips. The host honors two test-only env vars so CI
never has to spawn real CLI binaries:

- `AI_DEV_SIDEBAR_EXEC_OVERRIDE` — JSON `{cmd, args}` that replaces the
  resolved backend command. The original prompt is appended as the final
  argv. Unset in production.
- `AI_DEV_SIDEBAR_SESSION_STATE_PATH` — overrides the on-disk
  `~/.ai-dev-sidebar/session-state.json` path so tests don't leak state.

Run the full suite (unit + integration) with `npm test`.

## Joplin clipper — done-criteria checklist

- [ ] `pnpm build` produces a clean custom bundle with `content/readability-bundle.js` present under `build/`.
- [ ] `pnpm test` (vitest) is green, including the new Joplin test files.
- [ ] Load `build/` unpacked in Brave → sidebar shows the new "Joplin" section.
- [ ] Settings → Joplin → paste token → Save → **Test connection** reports ✓ JoplinClipperServer.
- [ ] Right-click any page → "Clip to Joplin → Simplified page" → toast shows "Clipped: \<title\>" within ~2s.
- [ ] Open Joplin Desktop → the clipped note exists with the page's simplified Markdown body and `source_url` set.
- [ ] Select text on a page → right-click → "Clip to Joplin → Selection" → Joplin note body equals the selected text.
- [ ] Sidebar "Recent clips" list shows all four entries; clicking one opens the note in Joplin via the `joplin://` deep link.
- [ ] Stop Joplin Desktop → click Clip → toast says "Couldn't reach Joplin." Status dot turns red within 30s.
- [ ] Clear the token in Settings → Clip button still works mechanically but the result toast says "No Joplin API token configured."
- [ ] Click Clip on a `chrome://` page → toast says "Couldn't extract page content" (or similar).

## AI Chat — done-criteria checklist

- [ ] `pnpm build` produces a clean custom extension bundle.
- [ ] `pnpm test` (vitest) is green, including the four new chat test files.
- [ ] Native host installed (`pnpm install-host`); `pnpm diagnose-host` exits 0.
- [ ] Load `build/` unpacked in Brave → sidebar shows the new "AI Chat" section.
- [ ] On a Mac with Apple Intelligence enabled (macOS 26+, M-series), sending "hi" produces a streamed-feel response within ~5s.
- [ ] Sending "what's the URL of my current tab?" → model emits a `context.activeTab` tool call, a tool-result row appears, then a final assistant message naming the URL.
- [ ] Sending "create a Joplin note titled Hello with body World" (Joplin token configured, Web Clipper running) → model emits `joplin.createNote`, the tool result has the note id, final assistant message confirms; verify the note in Joplin Desktop.
- [ ] Pressing Stop during a turn → conversation shows "Stopped by user." within ~3s.
- [ ] Clear button empties the conversation; sending again starts fresh.
- [ ] Apple Intelligence disabled → first Send produces a "Foundation Models is unavailable…" assistant message within ~2s.
- [ ] Uninstall the native host (`pnpm uninstall-host`), reload extension → first Send produces a "Native host not installed…" assistant message within ~2s.
- [ ] Force the step cap by asking for something open-ended (e.g., "keep pinging Joplin forever") — after 10 tool calls the conversation gets the cap message and stops.
