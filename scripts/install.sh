#!/bin/bash
# Builds Dolly.app into ~/Applications: the `dolly` CLI (TypeScript, compiled
# by bun) next to `dolly-driver` (drivers/macos, Swift), signed with a stable
# identity so the Accessibility grant survives rebuilds. Falls back to ad-hoc
# signing, which needs the grant again after every rebuild.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
target="${DOLLY_INSTALL_DIR:-$HOME/Applications}"
app="$target/Dolly.app"

swift build -c release --package-path "$root/drivers/macos"
(cd "$root" && bun install --frozen-lockfile >/dev/null && bun run build:cli >/dev/null)

# Studio ships this same path as a full app; replacing it with the headless
# container would delete the shell the person runs.
if [ -f "$app/Contents/Info.plist" ] \
  && [ "$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$app/Contents/Info.plist" 2>/dev/null)" = "app.dolly.studio" ]; then
  echo "Dolly.app at $app is Studio; build it with: (cd apps/studio && bun run build:mac)" >&2
  exit 1
fi

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$root/drivers/macos/.build/release/dolly-driver" "$app/Contents/MacOS/dolly-driver"
cp "$root/.build/dolly" "$app/Contents/MacOS/dolly"
cp "$root/assets/AppIcon.icns" "$app/Contents/Resources/AppIcon.icns"

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>dolly-driver</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
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
  codesign --force --deep --sign "$identity" --identifier dev.abcdlsj.dolly "$app" >/dev/null
  echo "signed with: $identity"
else
  codesign --force --deep --sign - --identifier dev.abcdlsj.dolly "$app" >/dev/null
  echo "signed ad-hoc: the Accessibility grant must be renewed after each rebuild"
fi

echo "installed: $app/Contents/MacOS/dolly"
echo "next: $app/Contents/MacOS/dolly service start && $app/Contents/MacOS/dolly trust --prompt"
