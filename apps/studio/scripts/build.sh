#!/bin/bash
# Builds Dolly.app for macOS with a stable signing identity.
#
# Accessibility grants are keyed to the code signature. An ad-hoc build gets a
# fresh hash on every rebuild, so the grant in System Settings keeps pointing at
# a binary that no longer exists: the row still shows a toggle, and `dolly
# trust` still answers false. Signing with an Apple Development identity makes
# the grant survive rebuilds.
set -euo pipefail

cd "$(dirname "$0")/.."

identity="${DOLLY_SIGN_IDENTITY:-}"
if [ -z "$identity" ]; then
  identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -n 's/.*"\(Apple Development[^"]*\)"$/\1/p' | head -1 || true)"
fi

if [ -n "$identity" ]; then
  echo "signing with: $identity"
  APPLE_SIGNING_IDENTITY="$identity" exec bun run tauri build "$@"
fi

echo "warning: no Apple Development identity found; building ad-hoc, so the" >&2
echo "Accessibility grant must be renewed after every rebuild." >&2
exec bun run tauri build "$@"
