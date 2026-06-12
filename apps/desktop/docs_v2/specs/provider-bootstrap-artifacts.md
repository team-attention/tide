# Spec: Provider Bootstrap Artifacts

## Scope

This spec makes the live Backend create and verify Tide-owned bootstrap artifacts for Provider CLI Agents before starting an Agent Runtime.

It covers:

- Codex CODEX_HOME overlay files for Tide hooks, Tide MCP, and Tide context skill.
- Claude Code settings and MCP config files used by launch plans.
- Antigravity plugin source files used by `agy plugin install`.
- live Provider Readiness checks that verify Tide-owned bootstrap artifacts instead of unrelated provider user files.
- Agent Runtime environment identity for future Provider Signal hook correlation.

## Evidence

- `docs_v2/master-plan.md` keeps Provider Signals as observer evidence tied to the hidden PTY runtime and says hook/bootstrap readiness is part of Provider Readiness.
- `docs_v2/specs/provider-integration-bootstrap.md` requires Codex hook/bootstrap config, Claude `--settings` plus `--mcp-config`, and Antigravity plugin-owned `hooks.json` plus `mcp_config.json`.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` says Antigravity runtime hook loading was proven for a global plugin with root `hooks.json`, and production bootstrap must verify the installed-layout contract.
- v1 wrapper files under `crates/tide-app/resources/bin/` show Codex overlay, Claude settings/MCP files, and provider hook command injection as the reference pattern.
- Current v2 live wiring in `src/backend/infrastructure/node/live/live-backend.ts` passes Claude paths under missing `docs_v2/mcp` files, marks Codex hook bootstrap ready unconditionally, and does not pass an Antigravity plugin install source.

## Decisions

- Tide owns generated bootstrap artifacts under `<home>/.tide/agent-bootstrap` by default.
- Codex uses a generated CODEX_HOME overlay. The overlay allowlists only provider-owned state needed for Tide runtime continuity: `auth.json`, `sessions`, `history.jsonl`, and `models_cache.json`. Tide owns overlay `config.toml`, `hooks.json`, and `skills/tide/SKILL.md`.
- Codex overlay generation removes stale app/plugin/cache state outside that allowlist. It must not inherit or preserve Codex app plugin state such as `plugins`, `vendor_imports`, `cache`, browser state, sqlite databases, or non-Tide skills across bootstrap refreshes.
- Claude uses generated `mcp.json` and `settings.json` paths from the Tide bootstrap root.
- Claude and Antigravity MCP config files launch the generated `tide-mcp-stdio` wrapper with the active `TIDE_SOCKET`.
- Antigravity uses a generated plugin source directory. Provider Readiness is ready only after the provider-installed plugin layout exists under `<home>/.gemini/config/plugins/tide`.
- Runtime launch plans receive `TIDE_THREAD_ID`, `TIDE_RUNTIME_ID`, and `TIDE_AGENT_ID` env values when the PTY is spawned.

## Out Of Scope

- Full Provider Signal file watching or socket ingestion.
- Provider Signal spool reading, which is covered by [Provider Signal Spool Ingress](provider-signal-spool-ingress.md).
- Full terminal screen rendering for Provider Setup Surface.
- Real provider smoke execution in the default test suite.

## Domain Model

### Provider Bootstrap Artifacts

Backend-owned generated files that provider CLIs can consume as their native hook, MCP, and context configuration.

### Installed Antigravity Plugin

Provider-owned installed plugin layout under the user's Antigravity config root. The source plugin is not enough to mark Provider Readiness ready.

## Contracts

`providerBootstrapArtifactsForHome(homeDir)` returns deterministic artifact paths without writing files.

`ensureProviderBootstrapArtifacts(input)` creates or updates Tide-owned artifacts and returns the paths used by Agent Integrations.

Provider state readers use these readiness checks:

- Codex `hookBootstrapReady`: generated Codex overlay contains `hooks.json` and `skills/tide/SKILL.md`. Tide still preserves provider-written hook trust entries when they exist, but readiness does not require them because Codex runtime launch uses `--dangerously-bypass-hook-trust` for Tide-owned generated hooks.
- Claude `hookBootstrapReady`: generated Claude `mcp.json` and `settings.json` exist.
- Antigravity `pluginBootstrapReady`: installed plugin contains `plugin.json`, `hooks.json`, and `mcp_config.json`.

## Flow

### UC-1: Live Backend starts with Provider CLI integrations

1. Backend resolves the user's home directory.
2. Backend ensures Tide-owned bootstrap artifacts exist.
3. Backend creates Provider CLI Agent Integrations with generated artifact paths.
4. Provider Readiness checks user provider state and Tide-owned bootstrap readiness.

### UC-2: Antigravity plugin is not installed

1. Antigravity source plugin files exist under Tide bootstrap root.
2. Installed Antigravity plugin files are missing under provider config.
3. Provider Readiness returns `hook_bootstrap_required` with setup action `agy plugin install <source>`.

### UC-3: Agent Runtime starts a Provider CLI process

1. Agent Runtime creates a runtime id.
2. Agent Runtime spawns the PTY with launch plan env plus Thread/runtime/Agent identity.
3. Hook commands can correlate later Provider Signals to that runtime identity.

## Invariants

1. Bootstrap artifact generation does not mutate user-owned provider config files.
2. Antigravity source plugin files do not make readiness ready until the provider-installed plugin layout exists.
3. Runtime identity env is added by the Agent Runtime port at spawn time, not by individual provider launch-plan builders.

## Tests

| Behavior | Test |
|----------|------|
| Bootstrap artifacts are created with Codex, Claude, Antigravity, and wrapper-backed MCP files | `provider_bootstrap_artifacts_create_provider_native_files` |
| Codex overlay keeps only runtime state and Tide-owned bootstrap files | `provider_bootstrap_artifacts_create_provider_native_files` |
| Provider state readers require Tide-owned bootstrap artifacts | `live_backend_provider_state_readers_require_tide_owned_bootstrap_artifacts` |
| Provider state readers report ready after bootstrap plus provider installed layout | `live_backend_provider_state_readers_use_local_provider_files` |
| Codex readiness is not blocked by missing provider-written hook trust when Tide-owned hook files exist | `live_backend_codex_bootstrap_ready_uses_generated_artifacts_without_hook_trust` |
| Runtime spawn env includes Thread/runtime/Agent identity | `agent_runtime_port_adds_runtime_identity_env_to_provider_process` |

## Implementation Notes

- Keep filesystem writing in `src/backend/infrastructure/node/provider/provider-bootstrap-artifacts.ts`.
- Keep provider-specific launch-plan construction in Agent Integration adapters.
- Re-export only the minimal helpers needed by tests and live wiring.
