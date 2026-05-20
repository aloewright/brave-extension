![brave dev extension](assets/readme-banner.svg)

# AI Dev Sidebar

[![Tests](https://github.com/aloewright/ai-dev-sidebar/actions/workflows/test.yml/badge.svg)](https://github.com/aloewright/ai-dev-sidebar/actions/workflows/test.yml)

Sidebar AI chat connected to local CLI tools — Claude Code, Gemini, Copilot, Codex — with page inspection and scraping.

Built with [Plasmo](https://www.plasmo.com/) for Chrome.

## New tab page

![New tab screenshot](assets/newtab-screenshot.png)

The extension replaces the new tab page with a Brave-style search bar, a row
of icon-only Quick Links (chat / email / calendar / tasks / link shortener),
and a draggable grid of Workspace App tiles.

### Customizing the Quick Links row

The five icon-only links above the app grid are hardcoded in
[`src/newtab.tsx`](src/newtab.tsx) as the `QUICK_LINKS` constant
(around line 304). Each entry has a `label`, a `url`, and an inline SVG
`icon`. To point them at your own chat, email, calendar, task tracker,
and shortlink service, edit the `url` fields in place:

```ts
const QUICK_LINKS: { label: string; url: string; icon: ReactNode }[] = [
  { label: "Chat",           url: "https://chat.example.com",     icon: (/* ... */) },
  { label: "Email",          url: "https://mail.example.com",     icon: (/* ... */) },
  { label: "Calendar",       url: "https://calendar.example.com", icon: (/* ... */) },
  { label: "Tasks",          url: "https://tasks.example.com",    icon: (/* ... */) },
  { label: "Link Shortener", url: "https://s.example.com",        icon: (/* ... */) },
];
```

- **Change destination only**: edit `url`. The `label` is read aloud by
  screen readers and shown as the hover tooltip, so update it to match
  if you repurpose a slot (e.g. swap "Tasks" for "Notes").
- **Add or remove a link**: add/remove an object in the array. The row
  renders whatever is in `QUICK_LINKS`, in order. There's no upper limit,
  but the layout is tuned for ~5 items.
- **Use your own icon**: each `icon` is a fragment of SVG `<path>` /
  `<rect>` elements that get drawn inside a shared 24×24 stroked
  viewBox (`fill="none"`, `stroke="currentColor"`,
  `strokeWidth="1.8"`). Drop in any path data from
  [Lucide](https://lucide.dev/), [Tabler](https://tabler.io/icons), or
  Hero­icons (outline set) and it will inherit the row's styling.

After editing, run `pnpm dev` to hot-reload the unpacked extension or
`pnpm build` to produce a fresh `build/` for packaging.

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
pnpm dev            # starts plasmo dev (loads as unpacked extension from build/)
pnpm build          # production build
pnpm install-host   # install the native messaging host
pnpm typecheck      # tsc --noEmit -p .
pnpm test           # vitest run
pnpm test:coverage  # vitest + v8 coverage (60% line / 50% branch floor)
pnpm test:e2e       # playwright e2e suite
```

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
deps with `--ignore-scripts` so Plasmo's post-install hooks don't fire — the
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
