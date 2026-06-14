#!/bin/bash
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
shopt -s nullglob

paths=(
  "$ROOT"/native-host/node_modules/.pnpm/node-pty@*/node_modules/node-pty/build/Release/pty.node
  "$ROOT"/native-host/node_modules/.pnpm/node-pty@*/node_modules/node-pty/build/Release/spawn-helper
  "$ROOT"/native-host/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-arm64/pty.node
  "$ROOT"/native-host/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper
  "$ROOT"/native-host/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-x64/pty.node
  "$ROOT"/native-host/node_modules/.pnpm/node-pty@*/node_modules/node-pty/prebuilds/darwin-x64/spawn-helper
)

count=0
remaining=0
for f in "${paths[@]}"; do
  [ -e "$f" ] || continue
  /usr/bin/xattr -d com.apple.quarantine "$f" 2>/dev/null || true
  /usr/bin/xattr -d com.apple.provenance "$f" 2>/dev/null || true
  /usr/bin/xattr -d com.apple.macl "$f" 2>/dev/null || true
  attrs="$(/usr/bin/xattr "$f" 2>/dev/null || true)"
  if printf '%s\n' "$attrs" | grep -Eq 'com\.apple\.(quarantine|provenance|macl)'; then
    remaining=$((remaining + 1))
  fi
  count=$((count + 1))
done

if [ "$remaining" -gt 0 ]; then
  echo "⚠ Gatekeeper xattrs remain on $remaining/$count node-pty artifact(s)."
elif [ "$count" -gt 0 ]; then
  echo "✓ Shell-scrubbed Gatekeeper xattrs on $count node-pty artifact(s)."
fi
