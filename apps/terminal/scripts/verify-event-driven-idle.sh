#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP="$ROOT/crates/tide-app/src"

check_absent() {
  local pattern=$1
  shift
  if rg -n "$pattern" "$@"; then
    echo "event-driven idle verification failed: forbidden pattern '$pattern'" >&2
    exit 1
  fi
}

check_absent 'detect_cwd_fallback|proc_listchildpids|last_child_check|is_child_alive' \
  "$APP/domain" "$APP/application" "$APP/adapter"
check_absent 'GitPoll|trigger_git_poll|start_git_poller' "$APP"
check_absent 'recv_timeout|thread::sleep' \
  "$APP/adapter/inward/cli_adapter/server.rs" \
  "$APP/application/services/file_tree_service" \
  "$APP/application/services/file_ops_service" \
  "$APP/application/services/pane_create_service"
check_absent 'fn next_timeout|default max sleep|Duration::from_millis\(100\).*max' \
  "$APP/adapter/inward/event_loop_adapter/mod.rs"
check_absent 'had_terminal_output' "$APP/application/services/update_service/mod.rs"

echo "event-driven idle verification passed"
