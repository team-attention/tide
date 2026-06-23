# Spec: Provider Bootstrap Artifacts

## Scope

The live Backend creates and verifies Tide-owned bootstrap artifacts for active
Provider CLI Agents before starting an Agent Runtime.

Current active Provider CLI Agents:

- codex
- claude
- opencode

Antigravity-specific plugin/bootstrap work is archived and is not part of the
current product path.

## Decisions

- Tide-owned generated files live under `<home>/.tide/agent-bootstrap` by default.
- Codex uses the provider-native effective Codex home from the user's terminal shell
  environment, falling back to `~/.codex`; Tide does not create a generated
  `CODEX_HOME` overlay.
- Claude uses generated Tide MCP/settings paths from the Tide bootstrap root where
  its launch plan needs them.
- opencode uses the shared structured ACP runtime path. Its provider integration
  owns protocol-specific setup and model/permission config.
- opencode vendor auth stays provider-owned: Tide connects through opencode's own
  local server/config path and never creates a Tide API runtime.
- Runtime launch plans receive `TIDE_THREAD_ID`, `TIDE_RUNTIME_ID`, and
  `TIDE_AGENT_ID` env values when a provider process is spawned.

## Out Of Scope

- Direct API Agent runtime bootstrap.
- Antigravity plugin installation.
- Full Provider Signal file watching or socket ingestion.
- Real provider smoke execution in the default test suite.

## Contracts

`providerBootstrapArtifactsForHome(homeDir)` returns deterministic artifact paths
without writing files.

`ensureProviderBootstrapArtifacts(input)` creates or updates Tide-owned artifacts and
returns the paths used by Agent Integrations.

Provider state readers verify provider-owned readiness plus Tide-owned bootstrap
readiness where that provider needs generated artifacts.

## Invariants

1. Bootstrap artifact generation does not mutate unrelated user-owned provider config
   files.
2. Provider-specific setup stays in the provider integration adapter.
3. Runtime identity env is added by the Agent Runtime port at spawn time, not by
   individual provider launch-plan builders.

## Tests

| Behavior | Test |
|----------|------|
| Bootstrap artifacts are created with provider-native files | `provider_bootstrap_artifacts_create_provider_native_files` |
| Codex bootstrap avoids generated CODEX_HOME overlays and uses only the Tide MCP bridge | `provider_bootstrap_artifacts_create_provider_native_files` |
| Provider state readers require Tide-owned bootstrap artifacts where applicable | `live_backend_provider_state_readers_require_tide_owned_bootstrap_artifacts` |
| Runtime spawn env includes Thread/runtime/Agent identity | `agent_runtime_port_adds_runtime_identity_env_to_provider_process` |

## Implementation Notes

- Keep filesystem writing in `src/backend/infrastructure/node/provider/provider-bootstrap-artifacts.ts`.
- Keep provider-specific launch-plan construction in Agent Integration adapters.
- Re-export only the minimal helpers needed by tests and live wiring.
