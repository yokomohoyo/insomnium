#!/bin/bash
# SPIKE ONLY (spike/mas-sandbox, never merge).
# Ad-hoc sign an Electron .app inside-out, the way @electron/osx-sign orders it:
#   1. every loose Mach-O (dylibs, .node addons, helper executables such as
#      chrome_crashpad_handler); executables get the inherit entitlements
#   2. every .framework bundle, deepest first
#   3. every nested .app (the Electron helpers) with the inherit entitlements
#   4. the main .app last with the parent entitlements
# No hardened runtime (--options none): MAS does not require it, and ad-hoc +
# hardened runtime would trip library validation for the control build.
# Usage: sign-adhoc.sh <App.app> <parent-entitlements.plist> <inherit-entitlements.plist>
set -euo pipefail

APP="$1"
ENT="$2"
ENT_INHERIT="$3"
MAIN_EXE="$APP/Contents/MacOS/$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$APP/Contents/Info.plist")"

sign() {
  echo "+ codesign $*"
  codesign --force --sign - --timestamp=none "$@"
}

# 1. loose Mach-O files that are not a bundle's main executable
while IFS= read -r -d '' f; do
  [ "$f" = "$MAIN_EXE" ] && continue
  case "$f" in
    *.app/Contents/MacOS/*) continue ;;                 # helper main executables: signed with their bundle
    *.framework/Versions/*/*)
      fwdir="${f%%.framework/*}.framework"
      fwname="$(basename "$fwdir" .framework)"
      [ "$(basename "$f")" = "$fwname" ] && continue ;;  # framework main binary: signed with the bundle
  esac
  desc="$(file -b "$f")"
  case "$desc" in
    *Mach-O*executable*) sign --entitlements "$ENT_INHERIT" "$f" ;;
    *Mach-O*) sign "$f" ;;
  esac
done < <(find "$APP/Contents" -type f -print0)

# 2. frameworks, deepest first
find "$APP/Contents" -type d -name '*.framework' | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2- |
  while IFS= read -r fw; do sign "$fw"; done

# 3. nested apps (helpers), deepest first
find "$APP/Contents" -mindepth 1 -type d -name '*.app' | awk '{ print length, $0 }' | sort -rn | cut -d' ' -f2- |
  while IFS= read -r h; do sign --entitlements "$ENT_INHERIT" "$h"; done

# 4. main app
sign --entitlements "$ENT" "$APP"

codesign --verify --deep --strict --verbose=2 "$APP"
