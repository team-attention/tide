#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
DIST_DIR="${2:-$ROOT_DIR/target/dist}"

if [ -z "$VERSION" ]; then
    VERSION=$(grep '^version' "$ROOT_DIR/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')
fi

if [ -z "$VERSION" ]; then
    echo "Could not determine Tide Terminal version" >&2
    exit 1
fi

DMG_NAME="Tide-Terminal-${VERSION}.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"
METADATA_PATH="$DIST_DIR/latest-mac.json"
RELEASE_TAG="v${VERSION}"
RELEASE_URL="https://github.com/eatnug/tide-terminal-releases/releases/tag/${RELEASE_TAG}"
DOWNLOAD_URL="https://github.com/eatnug/tide-terminal-releases/releases/download/${RELEASE_TAG}/${DMG_NAME}"

if [ ! -f "$DMG_PATH" ]; then
    echo "Tide Terminal DMG not found at $DMG_PATH" >&2
    exit 1
fi

SHA256=$(shasum -a 256 "$DMG_PATH" | awk '{print $1}')
SIZE_BYTES=$(wc -c < "$DMG_PATH" | tr -d ' ')
RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$METADATA_PATH" <<JSON
{
  "product": "Tide Terminal",
  "platform": "darwin",
  "version": "$VERSION",
  "artifact": "$DMG_NAME",
  "sizeBytes": $SIZE_BYTES,
  "sha256": "$SHA256",
  "releaseUrl": "$RELEASE_URL",
  "downloadUrl": "$DOWNLOAD_URL",
  "releaseDate": "$RELEASE_DATE"
}
JSON

echo "Wrote Tide Terminal update metadata to $METADATA_PATH"
