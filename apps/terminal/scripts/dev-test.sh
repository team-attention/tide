#!/usr/bin/env bash
set -euo pipefail

# Tide dev-test: one-command build + test + lint
# Usage:
#   ./scripts/dev-test.sh          # full: clippy + test + release build
#   ./scripts/dev-test.sh --quick  # quick: clippy + test only
#   ./scripts/dev-test.sh --bench  # full + benchmarks

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

MODE="full"
for arg in "$@"; do
    case "$arg" in
        --quick) MODE="quick" ;;
        --bench) MODE="bench" ;;
        --help|-h)
            echo "Usage: $0 [--quick|--bench]"
            echo "  (default)  clippy + test + release build"
            echo "  --quick    clippy + test only"
            echo "  --bench    clippy + test + release build + benchmarks"
            exit 0
            ;;
        *) echo "Unknown option: $arg"; exit 1 ;;
    esac
done

step() {
    local label="$1"
    shift
    printf "${CYAN}[%s]${NC} %s\n" "$(date +%H:%M:%S)" "$label"
    local start
    start=$(date +%s)
    if "$@"; then
        local elapsed=$(( $(date +%s) - start ))
        printf "${GREEN}  -> passed${NC} (%ds)\n\n" "$elapsed"
    else
        local elapsed=$(( $(date +%s) - start ))
        printf "${RED}  -> FAILED${NC} (%ds)\n" "$elapsed"
        exit 1
    fi
}

total_start=$(date +%s)

echo ""
printf "${YELLOW}Tide dev-test (%s)${NC}\n\n" "$MODE"

step "clippy" cargo clippy --workspace -- -D warnings
step "test"   cargo test --workspace

if [ "$MODE" != "quick" ]; then
    step "build (release)" cargo build --release -p tide-app
fi

if [ "$MODE" = "bench" ]; then
    step "bench (terminal)" cargo bench --package tide-terminal
    step "bench (app)"      cargo bench --package tide-app
fi

total_elapsed=$(( $(date +%s) - total_start ))
printf "${GREEN}All done${NC} (%ds)\n" "$total_elapsed"
