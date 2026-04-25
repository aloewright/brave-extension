# AI Dev Sidebar

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
