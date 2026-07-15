# Spec: Provider CLI Executable Resolution

## Scope

Tide must run the same provider CLI executable that the user's terminal runs for
the same command name.

This covers Codex CLI, Claude Code, and opencode executable resolution for:

- Provider Readiness.
- Provider model catalogs.
- Agent Runtime launch plans.
- Provider CLI update checks.

This does not make Tide own, bundle, copy, or rank provider CLIs.

## Evidence

- A user can have multiple files named `codex`, `claude`, or `opencode` because
  providers support more than one normal install channel: standalone/native,
  npm global under a Node version manager, Homebrew/npm global, or a custom bin
  directory.
- Despite multiple files existing on disk, a terminal command such as `codex`
  resolves to exactly one executable through the shell PATH.
- Tide launches Codex through `codex app-server`. That launch must use the same
  executable the user's terminal would resolve for `codex`, not a separate
  Tide-specific ranking rule.
- Tide already imports the user's shell environment at Backend startup so a
  Finder-launched packaged app sees the terminal PATH instead of the minimal
  launchd PATH.

## Decisions

1. **The shell-resolved command is the source of truth.** For provider CLIs,
   Tide resolves the command name from the same augmented shell PATH used for
   provider runtimes and Workbench terminals.

2. **No provider CLI version ranking.** Tide must not scan all matching
   executables and choose the newest. If the user wants a different executable,
   they change the command resolution in their shell PATH or provider installer.

3. **No Tide-managed provider binary.** Tide does not place itself between the
   user and Codex/Claude/opencode with wrapper binaries or bundled provider CLI
   copies.

4. **One resolved executable per command.** Provider Readiness, model catalogs,
   update checks, and Agent Runtime launch plans must all call the same resolver
   and therefore agree on the executable path.

5. **Tide owns update detection, not executable selection.** Tide checks whether
   the shell-resolved provider CLI is older than the latest known provider
   release and surfaces a non-blocking update advisory when it is stale.

6. **The update button updates that same resolved executable.** If the provider
   exposes a native updater (`codex update`, `claude update`, `opencode
   upgrade`), Tide's update action runs that command against the same absolute
   executable path used for readiness, catalogs, and runtime launch.

7. **Known Tide wrapper dirs stay excluded from PATH restoration.** The v1 Tide
   Terminal wrapper directory is not imported into the v2 Backend PATH because
   that would make Tide resolve provider commands to another Tide product's
   wrappers rather than the user's provider CLI.

## Out Of Scope

- Auto-installing provider CLIs.
- Deleting duplicate provider installs.
- A settings UI for choosing one provider executable manually.
- Hard-coding provider version support tables.

## Domain Model

- Shell PATH: the command search path restored from the user's login or
  interactive login shell.
- Resolved provider executable: the absolute path returned by normal command
  resolution for `codex`, `claude`, or `opencode`.

## Contracts

No shared contract changes are required.

Provider inventory and catalog contracts already expose `environment.executablePath`
and `environment.version`; these fields should reflect the shell-resolved
executable.

## Flow

1. Backend startup imports the user's shell environment.
2. Backend merges the restored shell PATH, common fallback dirs, and the current
   process PATH while dropping known v1 Tide wrapper dirs.
3. A provider integration asks for `resolveExecutable("codex" | "claude" |
   "opencode")`.
4. The resolver runs normal command lookup against the Backend process PATH.
5. Provider readiness, model catalog, update checker, and launch plan use that
   same absolute path.
6. Workbench terminals receive an environment with the same restored PATH, so
   typing `codex` in a terminal and Tide launching `codex app-server` do not
   intentionally diverge.
7. The background update checker reads `<resolved executable> --version` and the
   provider package's latest published version.
8. If installed is older than latest, Tide shows an advisory in the Composer.
9. Clicking the advisory opens a Provider Readiness Terminal Action that runs the
   resolved executable's native updater, then re-runs provider readiness/catalog
   refresh after the terminal exits.

## Invariants

- Tide must not resolve to the v1 Tide Terminal wrapper directory.
- Tide must not choose a provider executable by newest version.
- The selected provider catalog and selected launch executable come from the same
  resolver.
- Update advisories compare the selected executable's installed version against
  the latest known provider release.
- Update actions target the selected executable path, not another install path
  discovered through npm, Homebrew, or PATH scanning.
- Generic command lookup behavior is unchanged.

## Tests

- `resolve-shell-path` keeps shell PATH ordering ahead of minimal launchd PATH.
- `resolve-shell-path` drops the v1 Tide Terminal wrapper bin.
- Provider install/update tests continue to target the resolved provider
  executable in place.
- Provider catalog/bootstrap tests continue to consume the shared resolver path.
- Version-management tests prove a stale resolved executable shows an advisory,
  and that update completion refreshes the advisory state.

## Implementation Notes

- Keep provider CLI command names in the provider integration infrastructure.
- Keep resolution synchronous and cheap; expensive version checks belong to the
  background update advisory path, not executable selection.
