#!/bin/bash
# Compatibility launcher for manifests installed before the native host moved
# to ~/.config/ai-dev-sidebar/native-host. New installs point there directly.
set -u

CONFIG_LAUNCHER="$HOME/.config/ai-dev-sidebar/native-host"
if [ -x "$CONFIG_LAUNCHER" ]; then
  exec "$CONFIG_LAUNCHER" "$@"
fi

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
HOST_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN=""
if [ -n "${AI_DEV_SIDEBAR_NODE:-}" ] && [ -x "$AI_DEV_SIDEBAR_NODE" ]; then
  NODE_BIN="$AI_DEV_SIDEBAR_NODE"
fi

# Preserve compatibility with launchers generated from nonstandard Node
# managers. Globs that do not match simply fail the executable check.
if [ -z "$NODE_BIN" ]; then
  for candidate in \
    "$HOME"/.vite-plus/js_runtime/node/*/bin/node \
    "$HOME"/.nvm/versions/node/*/bin/node \
    "$HOME"/.local/share/mise/installs/node/*/bin/node \
    "$HOME"/.fnm/node-versions/*/installation/bin/node \
    "$HOME"/.asdf/installs/nodejs/*/bin/node \
    "$HOME"/.volta/bin/node \
    "$HOME"/Library/pnpm/nodejs/*/bin/node; do
    [ -x "$candidate" ] || continue
    NODE_BIN="$candidate"
    break
  done
fi

if [ -z "$NODE_BIN" ]; then
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [ -z "$NODE_BIN" ]; then
  echo "ai-dev-sidebar: Node.js was not found; run pnpm install-host again." >&2
  exit 127
fi

exec "$NODE_BIN" "$HOST_DIR/ai-dev-host.mjs" "$@"
