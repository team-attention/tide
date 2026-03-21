#!/usr/bin/env bash
# lint-arch.sh — Enforce hexagonal architecture dependency rules.
#
# Two checks:
# 1. No domain state mutations in inward adapter free functions
# 2. No NEW impl App blocks in inward adapters (only whitelisted bridges allowed)
#
# Run: ./scripts/lint-arch.sh
# Exit 0 = clean, Exit 1 = violations found

set -euo pipefail

INWARD_DIR="crates/tide-app/src/adapter/inward"
violations=0

# ── Check 1: Domain state mutations ──────────────────────────────

MUTATION_PATTERNS=(
    'self\.focus\.(focused|focus_area|zoomed_pane)\s*='
    'self\.router\.set_focused'
    'self\.panes\.(insert|remove|retain)'
    'self\.layout\.(split|add_tab|remove|alloc_id|set_split_ratio)'
    'self\.ime\.(pending_creates|pending_destroys|pending_removes)'
    'self\.cache\.invalidate'
    'self\.cache\.needs_redraw\s*='
    'self\.assoc\.\w+\.(insert|remove)'
)

for pattern in "${MUTATION_PATTERNS[@]}"; do
    matches=$(grep -rnE "$pattern" "$INWARD_DIR" 2>/dev/null || true)
    if [ -n "$matches" ]; then
        if [ $violations -eq 0 ]; then
            echo "❌ Hexagonal architecture violations found:"
            echo ""
        fi
        while IFS= read -r line; do
            violations=$((violations + 1))
            echo "  [mutation] $line"
        done <<< "$matches"
    fi
done

# ── Check 2: impl App blocks ────────────────────────────────────
#
# Only these are allowed (thin dispatch bridges + infrastructure):
#   - cli_adapter/commands.rs: handle_cli_command (dispatch bridge)
#   - text_routing_adapter/mod.rs: send_text_to_target (ImeStatePort bridge)
#   - event_loop_adapter/mod.rs: init/main loop/IME proxy infrastructure

ALLOWED_IMPL_APP=(
    "cli_adapter/commands.rs"
    "text_routing_adapter/mod.rs"
    "event_loop_adapter/mod.rs"
)

impl_app_files=$(grep -rlE "^impl (crate::)?App \{" "$INWARD_DIR" 2>/dev/null || true)
if [ -n "$impl_app_files" ]; then
    while IFS= read -r file; do
        # Check if file is in the allowed list
        allowed=false
        for allowed_file in "${ALLOWED_IMPL_APP[@]}"; do
            if [[ "$file" == *"$allowed_file" ]]; then
                allowed=true
                break
            fi
        done
        if [ "$allowed" = false ]; then
            violations=$((violations + 1))
            echo "  [impl App] $file — impl App block not allowed in inward adapters"
        fi
    done <<< "$impl_app_files"
fi

# ── Result ───────────────────────────────────────────────────────

if [ $violations -eq 0 ]; then
    echo "✅ Hexagonal architecture: clean ($INWARD_DIR)"
    exit 0
else
    echo ""
    echo "Found $violations violation(s)."
    echo ""
    echo "Fix: Use port trait methods instead of direct field access."
    echo "     New impl App blocks are not allowed — use free functions with port bounds."
    echo ""
    echo "See CLAUDE.md → 'Hexagonal Layer Rules' for details."
    exit 1
fi
