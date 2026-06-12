# Spec: Provider Command & Skill Discovery

## Scope

Surface the **real** provider slash-commands and skills in the composer's `/`
(and `$`) suggestion menu, discovered dynamically for the active Project cwd —
not a hardcoded list. Covers Claude Code, Codex, and Antigravity.

## Evidence

Provider commands/skills are file-based and live in known per-cwd and per-home
locations (verified on disk). Discovering them by reading these files is dynamic
per directory AND avoids spawning any provider (which the codex-auth constraint
forbids while Codex.app is running, and which is heavy/fragile for a menu).

| Provider | Location (project + home) | File | Name | Description |
|----------|---------------------------|------|------|-------------|
| Claude | `<cwd>/.claude/commands/*.md`, `~/.claude/commands/*.md` | `.md` | filename | YAML frontmatter `description` |
| Codex (skills, `$`) | `<cwd>/.codex/skills/*/SKILL.md`, `~/.codex/skills/*/SKILL.md` | `SKILL.md` | frontmatter `name` or dir | YAML frontmatter `description` |
| Antigravity | `<cwd>/.gemini/commands/*.toml`, `~/.gemini/commands/*.toml` | `.toml` | filename | TOML `description = "…"` |

Observed examples: `~/Workspace/tide/.claude/commands/{check,work,tide-v2-plan}.md`
(frontmatter `description:`), `~/Workspace/tide/.codex/skills/*/SKILL.md`
(`name`/`description`), `~/.gemini/commands/work.toml` (`description = "…"`).

The composer currently renders 4 hardcoded "Command suggestions" rows
(`agent-chat-shell-state.ts`), anchored to the input (done in #56).

## Decisions

- **Filesystem discovery, no provider spawn.** The cwd-varying part the user
  cares about ("닥 디렉토리마다 다름") is the project's custom commands/skills,
  which are files. Built-in/version-static provider commands are **out of scope
  for this slice** (they'd require spawning/scraping a provider TUI; deferred,
  and never for codex).
- **Per-cwd + home merge**, project entries take precedence over home on name
  collision. Deduped by `name`.
- **Trigger prefixes**: `/` lists commands (claude commands, antigravity
  commands); `$` lists skills (codex skills). A provider with no entries for a
  prefix shows nothing for it.
- Discovery runs in the **main process** (it already owns cwd/registry/git IPC),
  exposed as `tide:list-commands(cwd, agentId)`; the desktop injects the result
  into the composer's command-suggestion surface (same pattern as the project
  registry / git context).
- Read-only; never writes to the cwd.

## Out Of Scope

- Built-in/version-static provider slash commands (need a provider spawn/scrape).
- Live streaming from a running provider session.
- Executing the command (this slice only lists + inserts the token into the draft).

## Domain Model

`ProviderCommandSuggestion`:
```
name: string          // e.g. "tide-v2-plan"
description: string
trigger: "/" | "$"    // slash command vs skill
source: "project" | "user"
agentId: "codex" | "claude" | "antigravity"
```

## Contracts

Main-process IPC `tide:list-commands` → `(cwd: string, agentId: string) => ProviderCommandSuggestion[]`.
Preload exposes `listCommands(cwd, agentId)`. No backend/agent-runtime contract
change.

## Flow

1. When the composer's active Project cwd or agent changes, the desktop calls
   `listCommands(cwd, agentId)` and stores the result.
2. Typing `/` (or `$`) opens the command-suggestion surface, populated from the
   stored list (filtered by the typed prefix/text), anchored to the input (#56).
3. Selecting a row inserts the command token into the draft.

## Invariants

- A command/skill appears at most once (deduped by name; project over user).
- Discovery never spawns a provider and never writes to the cwd.
- Antigravity is a first-class provider here alongside claude and codex.

## Tests

`tests/provider-command-discovery.test.ts`:
- `claude_command_md_parses_name_and_description`
- `codex_skill_md_parses_name_and_description`
- `antigravity_toml_parses_name_and_description`
- `discovery_merges_project_over_user_and_dedupes`
- `discovery_tags_trigger_slash_for_commands_and_dollar_for_skills`

## Location

- `src/desktop/infrastructure/electron/main/provider-command-discovery.ts` — pure
  parsers + orchestrator (injected fs).
- `src/desktop/infrastructure/electron/main/electron-main.ts` — `tide:list-commands` wiring.
- `src/desktop/.../tide-product-shell.ts` + `agent-chat-shell-state.ts` —
  inject + render the suggestions.
