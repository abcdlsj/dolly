#!/bin/bash
# Builds Dolly.app: the Go/Wails shell with the frontend embedded, the `dolly`
# CLI (TypeScript, compiled by bun) and `dolly-driver` (drivers/macos, Swift)
# next to it. Signed with a stable identity, so the Accessibility grant survives
# rebuilds; ad-hoc signing works too, but then macOS asks again after each one.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$here/../.." && pwd)"
app="$here/dist/Dolly.app"

echo "frontend"
(cd "$here" && bun run build >/dev/null)

echo "dolly"
(cd "$root" && bun run build:cli >/dev/null)

echo "driver"
swift build -c release --package-path "$root/drivers/macos" >/dev/null

echo "shell"
rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources/skills" "$app/Contents/Resources/agent"
(cd "$here" && go build -trimpath -ldflags "-s -w" -o "$app/Contents/MacOS/Dolly" .)

cp "$root/.build/dolly" "$app/Contents/MacOS/dolly"
cp "$root/drivers/macos/.build/release/dolly-driver" "$app/Contents/MacOS/dolly-driver"
cp -R "$root/skills/dolly" "$app/Contents/Resources/skills/dolly"
cp "$here/agent/studio-extension.ts" "$app/Contents/Resources/agent/studio-extension.ts"
cp "$here/icons/icon.icns" "$app/Contents/Resources/icon.icns"

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key><string>Dolly</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundleIdentifier</key><string>app.dolly.studio</string>
  <key>CFBundleName</key><string>Dolly</string>
  <key>CFBundleDisplayName</key><string>Dolly</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.video</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
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
  codesign --force --deep --sign "$identity" --identifier app.dolly.studio "$app" >/dev/null
  echo "signed with: $identity"
else
  codesign --force --deep --sign - --identifier app.dolly.studio "$app" >/dev/null
  echo "signed ad-hoc: the Accessibility grant must be renewed after each rebuild"
fi

echo "built: $app"
