# Spec: Backend Agent Runtime Port Wiring

## Status

Implemented, revised 2026-06-20.

Backend runtime wiring supports the three Provider CLI Agents:

- `codex`
- `claude`
- `opencode`

Direct Tide-owned API Agent runtime routing is removed.

## Scope

This spec defines how Backend Thread runtime services connect to provider-specific Agent
Integrations.

It covers:

- Agent id -> Agent Integration selection.
- Provider Readiness preflight.
- Runtime `start`, `resume`, `writeInput`, and `stop`.
- Hidden runtime ownership.
- Provider-native session references.
- Provider-owned command/model/permission behavior.

It does not define any direct API Agent transport.

## Decisions

### D1. Agent Integration registry owns provider selection

Backend chooses the provider adapter from the Thread Agent Binding's `agentId`.

The registry contains only Codex, Claude, and opencode. Unknown Agent ids are
rejected instead of being routed to a generic runtime.

### D2. Provider Readiness uses selected provider preflight

`ProviderReadinessPort.check` calls the selected Agent Integration's preflight.

If preflight is blocked, Backend preserves pending Composer input and does not spawn or
write to the runtime.

### D3. Runtime start and resume use provider launch plans

`AgentRuntimePort.start` calls the selected integration's start plan.

`AgentRuntimePort.resume` calls the selected integration's resume plan and uses a
provider-native session reference when required.

### D4. First prompt uses provider CLI launch/start semantics

The first user message is passed through the selected provider's proven start path. Backend
does not launch a generic idle runtime and then blindly type the first message into it.

Follow-up Composer messages use `writeInput` or the provider's structured send mechanism.

### D5. Visible Workbench Terminal is separate

The hidden Agent Runtime is not the visible Workbench Terminal.

Workbench Terminal panes use `workbenchTerminalPort` and are Thread-owned visible panes.
Provider setup surfaces also use visible Workbench Terminal panes, but they are not Agent
Runtime conversations.

### D6. Removed API Agent bindings are rejected

If a removed direct API Agent id or runtime source reaches Backend, the readiness/runtime
ports reject it. There is no router from Thread Runtime Service to a Tide-owned API
runtime.

## Flow

### UC-1: Start Provider CLI Thread

1. Desktop emits `thread.start` with a provider CLI Agent Binding.
2. Backend Provider Readiness calls that provider's preflight.
3. If ready, Backend Agent Runtime asks that provider integration for a start plan.
4. Backend starts the runtime using the provider-specific transport.
5. Backend records local user input and projects provider output into Agent Session Blocks.

### UC-2: Block before runtime

1. Desktop emits `thread.start`.
2. Provider preflight returns blockers.
3. Backend returns Provider Readiness.
4. Backend preserves pending input and does not start the runtime.

### UC-3: Follow-up resumes provider session

1. Desktop emits `composer.sendInput` for an open Thread.
2. Backend resumes if no active runtime handle exists.
3. Backend sends follow-up input through the selected provider integration.

## Invariants

1. Provider-specific launch/resume plans are selected by Agent Binding.
2. Provider Readiness runs before runtime start or follow-up write.
3. Blocked readiness prevents process spawn and input write.
4. Backend application services do not import Node process or provider adapter modules.
5. Desktop and Shared Contracts do not import provider-specific runtime adapters.
6. Hidden Agent Runtime is not rendered as a default Terminal Pane.
7. Removed direct API Agent bindings never launch a runtime.

## Tests

| Rule | Test expectation |
|------|------------------|
| Provider Readiness uses selected integration | `provider_readiness_port_uses_selected_agent_integration_preflight` |
| Non-provider Agent rejected | `provider_readiness_port_rejects_non_provider_cli_agent` |
| Runtime adapter stays outbound | `agent_runtime_wiring_stays_out_of_desktop_and_shared_contracts` |
| Live backend provider CLI only | `live_backend_does_not_wire_openai_api_agent_runtime` |
| First prompt starts provider runtime | `starting_a_thread_with_ready_provider_starts_runtime_with_launch_prompt` |
| User input appears in Agent Session | `starting_ready_thread_records_local_user_message_block_before_runtime_output` |
