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
```

## Testing

Unit tests live in `tests/` and run on Vitest with a `happy-dom` environment.
An in-memory `chrome.storage.local` shim is installed in `tests/setup.ts`,
so storage-layer tests run without any browser/extension runtime.

```sh
npm test          # one-shot run
npm run test:watch
```

The `tests` GitHub Actions workflow (`.github/workflows/test.yml`) runs the
same `npm test` on every pull request and on every push to `main`. CI installs
deps with `--ignore-scripts` so Plasmo's post-install hooks don't fire — the
storage/types tests run in plain Node and don't need the built extension.
