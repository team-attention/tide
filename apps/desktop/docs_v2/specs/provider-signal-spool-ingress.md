# Spec: Provider Signal Spool Ingress

## Scope

This spec connects generated provider hook bootstrap files to the live Backend without adding a second Agent Runtime transport.

It covers:

- a Tide-owned hook script generated with Provider Bootstrap Artifacts.
- runtime-scoped Provider Signal JSONL spool files.
- Agent Runtime env values that let hook scripts correlate signals with Thread and runtime identity.
- live Backend polling that reads Provider Signal spool records and records Prompt State through existing Agent Integration classifiers.

## Evidence

- `docs_v2/master-plan.md` says Provider Signals enrich Agent Session rendering without becoming a separate runtime transport.
- `docs_v2/specs/provider-signal-prompt-ingress.md` records provider-observed Prompt State in the Backend, but leaves hook file watching and provider bootstrap scripts to a later transport slice.
- `docs_v2/specs/provider-bootstrap-artifacts.md` generates Tide-owned hook, MCP, and plugin bootstrap files and adds runtime identity env to Provider CLI PTY launches.
- v1 wrapper evidence under `crates/tide-app/resources/bin/` used hook commands to forward provider events back into Tide; v2 needs an equivalent Backend-owned ingress path.

## Decisions

- Hook scripts append JSONL records under `<home>/.tide/agent-bootstrap/provider-signals`.
- Each runtime writes to `<runtimeId>.jsonl`.
- Hook records carry `agent`, `event`, `threadId`, `runtimeId`, and raw provider payload.
- The live Backend polls runtime-scoped spool files after runtime start and after runtime output.
- Provider-specific Prompt State classification stays inside Agent Integration adapters.

## Out Of Scope

- Real provider smoke execution in the default test suite.
- Replacing polling with native filesystem watchers.
- Complete Agent Session Block grammar for every provider hook event.

## Domain Model

### Provider Signal Spool Record

A JSONL record emitted by a provider hook script for one Provider Signal observed from the same hidden PTY Agent Runtime.

### Provider Signal Spool Reader

A bounded reader that parses runtime-scoped JSONL records, deduplicates already-seen lines, and returns Backend raw-frame input.

## Contracts

Hook script invocation uses environment from the Agent Runtime spawn:

- `TIDE_THREAD_ID`
- `TIDE_RUNTIME_ID`
- `TIDE_AGENT_ID`
- `TIDE_PROVIDER_SIGNAL_DIR`

The hook script accepts:

- `--agent <agentId>`
- `--event <providerEventName>`

## Flow

### UC-1: Provider hook fires during a Thread turn

1. Provider CLI executes Tide's hook script.
2. Hook script reads provider stdin payload.
3. Hook script appends one JSONL record to the runtime spool file.
4. Live Backend polling reads the record.
5. Backend appends a `hook_payload` Raw Agent Frame.
6. Agent Integration classifier converts supported hook payloads to Prompt State.
7. Backend emits `prompt.changed` when Prompt State is found.

## Invariants

1. Provider Signal spool records never write Composer input to the Agent Runtime.
2. Provider Signals are observed evidence only; the hidden PTY remains the runtime transport.
3. Spool reading is bounded and deduplicated by file path plus line index.

## Tests

| Behavior | Test |
|----------|------|
| Bootstrap artifacts include the hook script and hook commands target it | `provider_bootstrap_artifacts_create_provider_native_files` |
| Runtime start callback carries Thread/runtime/Agent identity | `agent_runtime_port_notifies_runtime_start_with_identity` |
| Spool reader returns runtime-scoped hook records once | `provider_signal_spool_reader_reads_runtime_scoped_hook_records_once` |
| Live Backend projects spool prompt records into answerable Prompt State | `live_provider_signal_spool_prompt_roundtrip_records_prompt_and_preserves_provider_value` |

## Implementation Notes

- Keep the hook script generated under `src/backend/infrastructure/node/provider/provider-bootstrap-artifacts.ts`.
- Keep spool parsing in `src/backend/infrastructure/node/live/live-backend.ts` until a broader Provider Signal adapter boundary is justified.
