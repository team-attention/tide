#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/target/release/bundle/osx/Tide Terminal.app"
APP_PLIST="$APP_BUNDLE/Contents/Info.plist"
SKIP_BUILD=false

for arg in "$@"; do
    case "$arg" in
        --skip-build) SKIP_BUILD=true ;;
        --help|-h)
            echo "Usage: $0 [--skip-build]"
            echo "  (default)     cargo bundle + Info.plist fixup + ad-hoc sign"
            echo "  --skip-build  reuse the existing Tide Terminal.app and only apply fixups"
            exit 0
            ;;
        *) echo "Unknown option: $arg" >&2; exit 1 ;;
    esac
done

if [ "$SKIP_BUILD" = false ]; then
    cargo bundle --release -p tide-app
fi

if [ ! -d "$APP_BUNDLE" ]; then
    echo "Tide Terminal.app not found at $APP_BUNDLE" >&2
    exit 1
fi

if /usr/libexec/PlistBuddy -c "Print :LSRequiresCarbon" "$APP_PLIST" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Delete :LSRequiresCarbon" "$APP_PLIST"
fi

if /usr/libexec/PlistBuddy -c "Print :LSRequiresCarbon" "$APP_PLIST" >/dev/null 2>&1; then
    echo "Failed to strip LSRequiresCarbon from $APP_PLIST" >&2
    exit 1
fi

codesign --force --deep --sign - --identifier com.eatnug.tide-terminal "$APP_BUNDLE"

echo "Built Tide Terminal.app at $APP_BUNDLE"
