#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="${TMPDIR:-/tmp}/nodewarden-upstream-sync"

rm -rf "$TMP"
git clone --depth 1 https://github.com/shuaiplus/nodewarden "$TMP"

rsync -a \
  --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'BRAVE_DEV_PASSWORD_APP.md' \
  --exclude 'UPSTREAM.md' \
  --exclude 'scripts/sync-nodewarden-upstream.sh' \
  "$TMP/" "$ROOT/"

echo "Synced NodeWarden upstream into $ROOT"
echo "New upstream commit: $(git -C "$TMP" rev-parse HEAD)"
