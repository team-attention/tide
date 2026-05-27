#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="$HOME/agent-cli-backups/claude-$(date +%Y%m%d-%H%M%S)"

move_if_exists() {
  local path="$1"
  if [ -e "$path" ]; then
    mkdir -p "$BACKUP_ROOT"
    local dest_name
    dest_name="${path#$HOME/}"
    dest_name="${dest_name//\//__}"
    mv "$path" "$BACKUP_ROOT/$dest_name"
    echo "moved $path -> $BACKUP_ROOT/$dest_name"
  fi
}

uninstall_brew_cask_if_installed() {
  local cask="$1"
  if command -v brew >/dev/null 2>&1 && brew list --cask "$cask" >/dev/null 2>&1; then
    brew uninstall --cask "$cask"
  fi
}

uninstall_npm_global_if_installed() {
  local pkg="$1"
  if command -v npm >/dev/null 2>&1 && npm -g ls "$pkg" >/dev/null 2>&1; then
    npm uninstall -g "$pkg"
  fi
}

echo "== backup Claude Code state =="
move_if_exists "$HOME/.claude"
move_if_exists "$HOME/.claude.json"
move_if_exists "$HOME/.claude.json.backup"
move_if_exists "$HOME/.cache/claude"
move_if_exists "$HOME/.local/state/claude"
move_if_exists "$HOME/.local/share/claude"
move_if_exists "$HOME/Library/Application Support/Claude/claude-code"
move_if_exists "$HOME/Library/Application Support/Claude/claude-code-vm"

echo "== uninstall Claude Code CLI =="
uninstall_brew_cask_if_installed claude-code
uninstall_npm_global_if_installed @anthropic-ai/claude-code
rm -f "$HOME/.local/bin/claude"

echo "== reinstall Claude Code CLI =="
curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh
sh /tmp/claude-install.sh

echo "== verify =="
hash -r
command -v claude
claude --version

echo "== backup root =="
echo "$BACKUP_ROOT"
