# AI Dev Sidebar

[![Tests](https://github.com/aloewright/ai-dev-sidebar/actions/workflows/test.yml/badge.svg)](https://github.com/aloewright/ai-dev-sidebar/actions/workflows/test.yml)

Sidebar AI chat connected to local CLI tools — Claude Code, Gemini, Copilot, Codex — with page inspection and scraping.

Built with [Plasmo](https://www.plasmo.com/) for Chrome.

## Development

```sh
pnpm install
pnpm dev          # starts plasmo dev (loads as unpacked extension from build/)
pnpm build        # production build
pnpm install-host # install the native messaging host
pnpm typecheck    # runs `tsc --noEmit -p .` (no emit, just type-checking)
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
