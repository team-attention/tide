#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/target/release/bundle/osx/Tide.app"
APP_PLIST="$APP_BUNDLE/Contents/Info.plist"
SKIP_BUILD=false

for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=true ;;
        --help|-h)
            echo "Usage: $0 [--skip-build]"
            echo "  (default)     cargo bundle + Info.plist fixup + ad-hoc sign"
            echo "  --skip-build  reuse the existing Tide.app and only apply fixups"
            exit 0
            ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done

if [ "$SKIP_BUILD" = false ]; then
    cargo bundle --release -p tide-app
fi

if [ ! -d "$APP_BUNDLE" ]; then
    echo "Tide.app not found at $APP_BUNDLE" >&2
    exit 1
fi

/usr/libexec/PlistBuddy -c "Delete :LSMultipleInstancesProhibited" "$APP_PLIST" >/dev/null 2>&1 || true
/usr/libexec/PlistBuddy -c "Add :LSMultipleInstancesProhibited bool true" "$APP_PLIST"

codesign --force --deep --sign - --identifier com.eatnug.tide "$APP_BUNDLE"

echo "Built Tide.app at $APP_BUNDLE"
