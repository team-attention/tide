#!/usr/bin/env bash
# e2e.sh — Run the Tide end-to-end tests (separate lane from `cargo test`).
#
# The e2e tests launch the REAL windowed app and drive it over the Agent Gateway
# socket, so they need a macOS display session and must run serially. They are
# marked `#[ignore]` so a plain `cargo test` stays window-free; this script opts
# them in.
#
# Usage: ./scripts/e2e.sh   (run from apps/terminal/)

set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Building tide-terminal (debug) for the e2e harness…"
cargo build -p tide-app

# The harness locates the binary via TIDE_TERMINAL_BIN, else target/debug/tide-terminal,
# and launches it with TIDE_TERMINAL_TEST_DRIVER=1 so test-driver gateway methods
# (e.g. test-poll-state) are available.
echo "==> Running e2e tests (serial; --ignored)…"
cargo test -p tide-e2e-tests -- --ignored --test-threads=1 "$@"
