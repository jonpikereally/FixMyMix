#!/usr/bin/env bash
# Builds FixMyMix.app (universal: Intel + Apple Silicon), ad-hoc signs it, and
# wraps it in a drag-to-Applications DMG. macOS only (uses codesign, hdiutil).
#
#   npm run app:dmg                      → ~/Desktop/FixMyMix-build/FixMyMix-<version>.dmg
#   FIXMYMIX_APP_OUT=/path npm run app:dmg
#   FIXMYMIX_ARCH=arm64 npm run app:dmg  → single-architecture build (smaller)
set -euo pipefail
cd "$(dirname "$0")/../.."

OUT="${FIXMYMIX_APP_OUT:-$HOME/Desktop/FixMyMix-build}"
ARCH="${FIXMYMIX_ARCH:-universal}"
VERSION="$(node -p "require('./package.json').version")"
APP="$OUT/FixMyMix-darwin-$ARCH/FixMyMix.app"
DMG="$OUT/FixMyMix-$VERSION.dmg"

mkdir -p "$OUT"
# Same options as `npm run app:package`, plus the architecture.
npx electron-packager . FixMyMix \
  --platform=darwin --arch="$ARCH" --out="$OUT" --overwrite \
  --icon=desktop/icon \
  --app-bundle-id=com.rehearsaltool.fixmymix \
  --app-category-type=public.app-category.music \
  --app-version="$VERSION" \
  --extend-info=desktop/Info.plist \
  --prune=true \
  --ignore='^/(test|data|desktop/dist|\.github|\.claude)($|/)'

# Ad-hoc signature. Without any signature, an arm64 app copied to another Mac
# is refused as "damaged"; with one, it opens after the usual first-launch
# "unidentified developer" step.
codesign --force --deep --sign - "$APP"

STAGE="$(mktemp -d)"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$DMG"
hdiutil create -volname "FixMyMix $VERSION" -srcfolder "$STAGE" -ov -format UDZO "$DMG" >/dev/null
rm -rf "$STAGE"

echo
echo "Installer: $DMG"
echo "On the other Mac: open it, drag FixMyMix to Applications, then right-click FixMyMix → Open."
