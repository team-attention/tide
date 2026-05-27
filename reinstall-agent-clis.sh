#!/usr/bin/env bash
set -euo pipefail

FRESH_STATE="${FRESH_STATE:-0}"
BACKUP_ROOT="$HOME/agent-cli-backups/$(date +%Y%m%d-%H%M%S)"

move_if_exists() {
  local path="$1"
  if [ -e "$path" ]; then
    mkdir -p "$BACKUP_ROOT"
    mv "$path" "$BACKUP_ROOT/"
    echo "moved $path -> $BACKUP_ROOT/"
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

echo "== uninstall existing CLI binaries =="

uninstall_brew_cask_if_installed codex
uninstall_brew_cask_if_installed claude-code

uninstall_npm_global_if_installed @openai/codex
uninstall_npm_global_if_installed @anthropic-ai/claude-code

rm -f "$HOME/.local/bin/codex"
rm -f "$HOME/.local/bin/claude"
rm -f "$HOME/.local/bin/agy"
rm -rf "$HOME/.local/share/claude"

if [ "$FRESH_STATE" = "1" ]; then
  echo "== backing up provider state =="
  move_if_exists "$HOME/.codex"
  move_if_exists "$HOME/.claude"
  move_if_exists "$HOME/.claude.json"
  move_if_exists "$HOME/.claude.json.backup"
  move_if_exists "$HOME/.cache/claude"
  move_if_exists "$HOME/.local/state/claude"
  move_if_exists "$HOME/Library/Application Support/Claude/claude-code"
  move_if_exists "$HOME/Library/Application Support/Claude/claude-code-vm"
  move_if_exists "$HOME/.gemini/antigravity-cli"
fi

echo "== reinstall Codex CLI =="
curl -fsSL https://chatgpt.com/codex/install.sh -o /tmp/codex-install.sh
sh /tmp/codex-install.sh

echo "== reinstall Claude Code CLI =="
curl -fsSL https://claude.ai/install.sh -o /tmp/claude-install.sh
sh /tmp/claude-install.sh

echo "== reinstall Antigravity CLI =="
curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/agy-install.sh
bash /tmp/agy-install.sh

echo "== verify =="
hash -r
command -v codex
codex --version
command -v claude
claude --version
command -v agy
agy --version
