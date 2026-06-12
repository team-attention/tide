# Spec: Provider Signal Prompt Ingress

## Scope

This spec connects provider-observed prompt evidence to Backend-owned Prompt State so Desktop can show actionable choices and route `prompt.answer` back to the active Agent Runtime.

It covers:

- recording a Prompt State from provider signal evidence.
- updating Thread runtime state to waiting for input or approval.
- emitting `prompt.changed` from live Backend projection when an Agent Session reader returns Prompt State.
- keeping `prompt.answer` tied to the same active Agent Runtime.

It does not implement provider hook file installation, filesystem watching, a full provider-specific hook transport, or automatic prompt classification from unsupported raw terminal text.

## Evidence

- `docs_v2/master-plan.md` says provider questions, approval prompts, permission prompts, and similar runtime interactions are surfaced in Agent Session and answered back through the provider-native mechanism.
- `docs_v2/specs/provider-integration-bootstrap.md` defines `detectPromptState` on provider-specific Agent Integrations and evidence-gated prompt detection rules.
- `src/backend/application/services/fixture-agent-session-reader.ts` already returns `promptState` when a structured Raw Agent Frame projects to an approval, question, or choice prompt block.
- `src/backend/application/services/thread-runtime-service.ts` already routes `prompt.answer` to the active Agent Runtime and clears Prompt State.
- `src/backend/infrastructure/node/live/live-backend.ts` currently emits Agent Session Block events from provider output but does not persist or emit returned Prompt State.

## Decisions

### D1. Backend owns active Prompt State

Provider Signal projection may discover Prompt State, but the Backend Thread service records it so `prompt.answer` can validate and route the answer through the active Agent Runtime.

### D2. Prompt evidence does not start a second runtime

Recording Prompt State mutates Thread state only. It does not start, resume, or stop Agent Runtime.

### D3. Live projection emits Prompt State

When the live projection reader returns Prompt State, live Backend records it and emits `prompt.changed` to Desktop.

### D4. Backend resolves provider-native prompt values

Desktop may send both `choiceId` and `value`, but Backend must not depend on Desktop to preserve provider-native answer values.

When `prompt.answer` carries a `choiceId` and no explicit non-empty `value`, Backend looks up the active Prompt State choice and writes that choice's `providerValue` to Agent Runtime. If no matching provider value exists, Backend falls back to the `choiceId`.

## Flow

### UC-1: Provider signal creates Prompt State

1. Provider output or hook evidence is appended as a Raw Agent Frame.
2. Agent Session reader projects a Prompt State.
3. Backend records the Prompt State on the Thread.
4. Runtime state becomes `waiting_for_approval` for approval/permission, otherwise `waiting_for_input`.
5. Backend emits `prompt.changed`.

### UC-2: User answers Prompt State

1. Desktop emits `prompt.answer`.
2. Backend validates active Prompt State.
3. Backend writes the provider-native answer value to the same active Agent Runtime.
4. If no provider-native value exists, Backend falls back to the choice id.
5. Backend clears Prompt State.

## Invariants

1. Prompt State thread id must match the target Thread.
2. Prompt State agent id must match the Thread Agent Binding.
3. Recording Prompt State does not call Agent Runtime start or resume.
4. Answering Prompt State still requires an active Agent Runtime handle.

## Tests

| Rule | Test expectation |
|------|------------------|
| Provider Prompt State records in Backend | `recording_provider_prompt_state_marks_thread_waiting_without_runtime_start` proves Prompt State is recorded without runtime start/resume. |
| Prompt answer round trip remains runtime-bound | Existing `answering_an_active_prompt_writes_to_the_same_runtime_and_clears_prompt_state` proves answers go through the active runtime. |
| Prompt answers preserve provider-native values | `agent_runtime_port_writes_provider_native_prompt_value_before_ui_choice_id` proves provider answer bytes prefer provider-native values over UI choice ids. |
| Backend resolves choice id to provider value | `answering_prompt_with_choice_id_only_writes_provider_native_value` proves Backend resolves Prompt State choices even if Desktop omits `value`. |
| Live projector emits prompt event | `live_agent_session_projection_emits_prompt_changed_for_prompt_state` proves a projected Prompt State becomes a `prompt.changed` event. |
| Live spool prompt answer round trip | `live_provider_signal_spool_prompt_roundtrip_records_prompt_and_preserves_provider_value` proves runtime-scoped provider hook records create Prompt State through live Backend projection and that answering by UI `choiceId` writes the provider-native value to the same runtime. |

## Implementation Notes

- Keep provider-specific detection in Agent Integration adapters.
- Keep Thread service independent from Desktop contracts.
- Leave hook file watching and provider bootstrap scripts to a later Provider Signal transport slice.
