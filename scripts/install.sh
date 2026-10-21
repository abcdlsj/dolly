#!/bin/bash
# Builds Dolly.app into ~/Applications and signs it with a stable identity, so
# the Accessibility grant survives rebuilds. Falls back to ad-hoc signing,
# which needs the grant again after every rebuild.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${DOLLY_INSTALL_DIR:-$HOME/Applications}"
app="$target/Dolly.app"

swift build -c release --package-path "$root"
binary="$root/.build/release/dolly"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS"
cp "$binary" "$app/Contents/MacOS/dolly"

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>dolly</string>
  <key>CFBundleIdentifier</key><string>dev.abcdlsj.dolly</string>
  <key>CFBundleName</key><string>Dolly</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHumanReadableCopyright</key><string>MIT</string>
</dict>
</plist>
PLIST

identity="${DOLLY_SIGN_IDENTITY:-}"
if [ -z "$identity" ]; then
  identity="$(security find-identity -v -p codesigning 2>/dev/null \
    | grep -m1 'Apple Development' | sed -E 's/.*"(.*)"$/\1/' || true)"
fi

if [ -n "$identity" ]; then
  codesign --force --sign "$identity" --identifier dev.abcdlsj.dolly "$app" >/dev/null
  echo "signed with: $identity"
else
  codesign --force --sign - --identifier dev.abcdlsj.dolly "$app" >/dev/null
  echo "signed ad-hoc: the Accessibility grant must be renewed after each rebuild"
fi

echo "installed: $app/Contents/MacOS/dolly"
echo "next: $app/Contents/MacOS/dolly trust --prompt"
