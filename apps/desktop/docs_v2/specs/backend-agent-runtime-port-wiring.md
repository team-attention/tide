# Spec: Backend Agent Runtime Port Wiring

## Scope

This spec defines the first concrete wiring from Backend Thread runtime services to provider-specific Agent Integrations and a hidden PTY process launcher.

It covers:

- mapping AgentId to the correct Agent Integration.
- Provider Readiness checks through provider-specific `preflight`.
- `AgentRuntimePort.start` and `resume` building provider launch plans.
- hidden PTY process spawning through an outbound process adapter.
- Composer input and Prompt State answers writing to the same runtime handle.
- PTY stdout/stderr output forwarding back to Backend as Raw Agent Frame input.
- Antigravity provider-owned transcript updates becoming Agent Session Block input after hidden PTY launch.
- live Backend Provider Readiness state readers for local provider-owned files.

It does not define full Provider Signal readers, provider-owned history discovery, Electron utilityProcess spawning, or Tide API Agent transport.

## Evidence

- `docs_v2/specs/provider-integration-bootstrap.md` defines Codex, Claude Code, and Antigravity as provider-specific Agent Integrations that produce Backend-internal launch plans.
- `docs_v2/specs/backend-thread-agent-runtime-lifecycle.md` defines `AgentRuntimePort` and `ProviderReadinessPort` as required Backend outbound ports.
- `src/backend/application/services/thread-runtime-service.ts` already calls `providerReadinessPort.check` before writing user input and calls `agentRuntimePort.start`, `resume`, `writeInput`, and `stop`.
- `src/backend/adapters/outbound/agent-integrations/codex/codex-agent-integration.ts`, `claude-agent-integration.ts`, and `antigravity-agent-integration.ts` already implement provider-specific preflight and launch plan builders.
- `package.json` does not include `node-pty`, so the first concrete launcher must use an injectable process seam and a local PTY-capable launcher where available rather than assuming a packaged native dependency.
- User report on 2026-05-29: selecting Antigravity in the UI still showed a GPT model and submitting did not start a real Agent.

## Decisions

### D1. Agent Integration registry owns provider selection

Backend runtime wiring chooses the provider adapter from the Thread Agent Binding's `agentId`.

Antigravity starts through the Antigravity Agent Integration, not Codex or a generic GPT path.

### D2. Provider Readiness uses preflight result

`ProviderReadinessPort.check` calls the selected Agent Integration's `preflight`.

If preflight is blocked, Backend preserves pending Composer input and does not spawn or write to the runtime.

### D3. Runtime start and resume use provider launch plans

`AgentRuntimePort.start` calls `buildStartPlan`.

`AgentRuntimePort.resume` calls `buildResumePlan` and requires a provider session reference.

The resulting `ProviderLaunchPlan` stays Backend-internal.

### D4. PTY process launch is an adapter seam

The concrete runtime port delegates process creation to a `PtyProcessLauncher`.

Tests use a fake launcher for service behavior and one local PTY bridge smoke for transport behavior. The first local product launcher uses a Python stdlib PTY bridge until a packaged native PTY dependency is introduced, and the Backend application service remains independent from Node process APIs.

### D5. Input submit sequence is provider-aware

Composer input is written to the runtime process with the provider's required submit sequence.

Codex can use carriage return. Claude Code uses CSI-u Enter based on the hidden PTY evidence. Antigravity uses carriage return until a stronger Antigravity-specific input protocol is added.

Provider Launch Plans may also specify startup and pre-submit timing. The runtime waits for the selected provider's startup window before a write after launch or resume, then writes Composer text and the provider-specific submit key separately. This preserves the Provider Evidence Harness finding that provider TUIs sometimes need a short settle window before submit.

### D6. The first message is delivered as the launch-time initial prompt

Typing the first message into a provider TUI after launch is unreliable (the TUI
may not be ready, and no turn starts). Instead, the first user message is passed
to the provider CLI as its launch-time initial prompt, so the session starts a
turn immediately:

- Codex: positional `[PROMPT]` argument.
- Claude Code: positional `[prompt]` argument.
- Antigravity: `--prompt-interactive <prompt>`.

`AgentRuntimeStartInput.initialPrompt` carries the message into `buildStartPlan`.
For Provider CLI Agents the Backend therefore does NOT also type the first
message via `writeInput`; follow-up Composer messages still use `writeInput`
(submit sequence per above). Tide API Agents have no launch argv, so they
receive the first message via `writeInput`.

Note: the provider must also be authenticated and the Execution Context
directory trusted for a turn to actually produce an answer (Provider Readiness);
a launched-but-unauthenticated CLI returns provider auth errors, not an answer.

### D6. PTY output returns with runtime context

The PTY launcher forwards stdout and stderr chunks to the runtime port.

The runtime port labels each chunk with Thread id, Agent id, Runtime id, output source, and text body before handing it back to Backend orchestration. This keeps provider output visible without moving provider process ownership into Desktop.

### D7. Antigravity transcript history can repair sparse PTY output

Antigravity's PTY surface can be visually sparse even when the provider-owned transcript records the real conversation turn.

The live Backend projector therefore opens a short bounded polling window after Antigravity hidden PTY output, reads bounded recent Antigravity transcript JSONL records, and maps completed model `PLANNER_RESPONSE` entries to Agent Session agent message blocks. It does not copy the full provider transcript into Tide-owned storage.

### D8. Live Provider Readiness reads provider-owned state

The live Backend wiring does not mark every installed provider ready by default.

It reads bounded provider-owned files for authentication, onboarding, and Directory Trust evidence:

- Codex: `~/.codex/auth.json` and `~/.codex/config.toml`.
- Claude Code: `~/.claude.json` and `~/.claude/settings.json`.
- Antigravity: `~/.gemini/oauth_creds.json`, `~/.gemini/google_accounts.json`, `~/.gemini/antigravity-cli/cache/onboarding.json`, `~/.gemini/antigravity-cli/settings.json`, and Tide bootstrap files under `~/.gemini/config`.

Codex session reference discovery reads recent rollout files from real Codex history and the Tide CODEX_HOME overlay. The overlay path is required because live Codex launches run with Tide's generated CODEX_HOME.

### D9. Tide API Agents do not enter Provider CLI wiring

The Provider CLI runtime port is limited to `codex`, `claude`, and `antigravity`.

If `openai_api` reaches the Provider Readiness adapter before Tide API transport exists, readiness returns a Provider Account blocker and no provider-specific CLI preflight runs. If `openai_api` reaches the Provider CLI runtime port directly, the port rejects it instead of launching a hidden PTY.

### D10. Prompt answer bytes prefer provider-native values

Prompt State choices may carry both a Tide UI `choiceId` and a provider-native answer value.

When writing a `prompt.answer` to a Provider CLI Agent Runtime, the runtime port writes the provider-native value when present. It uses `choiceId` only as a fallback for prompts that do not carry a provider-native value.

### D11. Start Composer Launch Options reach the selected provider launch plan

Desktop sends the selected Agent Binding and Launch Options in `thread.start`.

Backend passes those Launch Options through Provider Readiness and `AgentRuntimePort.start`.

The selected Agent Integration is responsible for converting proven provider-native Launch Options into launch args. Antigravity selection must not inherit Codex model or permission defaults when a Thread starts.

## Bounded Contexts

- Backend application service: owns Thread lifecycle and calls outbound ports.
- Backend Agent Integration adapters: own provider launch plans and readiness details.
- Backend PTY adapter: owns process spawning and terminal input bytes.
- Desktop Renderer: emits Shared Contract command drafts and consumes Backend events.

## Flow

### UC-1: Start Antigravity Thread

1. Desktop emits `thread.start` with Agent Binding `antigravity`.
2. Backend Provider Readiness calls Antigravity preflight.
3. If ready, Backend Agent Runtime asks Antigravity Integration for a start plan.
4. Backend PTY launcher starts `agy` in the selected Execution Context.
5. Backend writes the initial Composer input to the returned runtime handle.

### UC-2: Block before runtime

1. Desktop emits `thread.start`.
2. Provider preflight returns blockers.
3. Backend returns Provider Readiness.
4. Backend does not call PTY launcher and does not write Composer input.

### UC-3: Follow-up resumes provider session

1. Desktop emits `composer.sendInput` for an open Thread.
2. Backend resumes if no active runtime handle exists.
3. Backend writes follow-up input to the resumed runtime handle.

### UC-4: Provider output becomes render input

1. Provider process writes stdout or stderr.
2. PTY launcher forwards the chunk to the runtime port.
3. Runtime port emits a Thread-scoped output frame input.
4. Backend records the chunk as Raw Agent Frame evidence and projects an Agent Session Block update.
5. For Antigravity, Backend also opens a bounded provider-history polling window and projects completed transcript model responses when available.

### UC-5: Live Backend checks provider state

1. Backend receives a start or follow-up command.
2. Provider Readiness resolves the selected provider executable.
3. Live provider state readers inspect provider-owned files for auth, onboarding, trust, and bootstrap evidence.
4. Missing evidence becomes Provider Readiness blockers before user input is written.

## Invariants

1. Provider-specific launch/resume plans are selected by Agent Binding.
2. Provider Readiness runs before every start or follow-up runtime write.
3. Blocked readiness prevents process spawn and input write.
4. Backend application services do not import Node process or provider adapter modules.
5. Desktop and Shared Contracts do not import provider-specific runtime adapters.
6. PTY output chunks are labeled with Thread id and Runtime id before rendering.
7. Live Backend does not treat installed provider executables alone as readiness.
8. Prompt answer terminal bytes preserve provider-native values before Tide UI ids.
9. Start Composer Launch Options are carried to the selected Agent Integration before runtime spawn.

## Tests

| Rule | Test expectation |
|------|------------------|
| Provider Readiness uses selected integration | `provider_readiness_port_uses_selected_agent_integration_preflight` proves Antigravity preflight is selected for Antigravity input. |
| Runtime starts selected provider | `agent_runtime_port_starts_antigravity_launch_plan_and_writes_input` proves Antigravity start uses `agy`, stores an Antigravity runtime handle, and writes the user input. |
| Runtime resumes provider session | `agent_runtime_port_resumes_provider_session_ref_before_follow_up_write` proves resume uses the provider session reference. |
| Runtime output keeps context | `agent_runtime_port_forwards_pty_output_with_thread_runtime_context` proves PTY output is labeled with Thread, Agent, Runtime, source, and body. |
| Local PTY bridge provides a real terminal | `python_pty_process_launcher_round_trips_terminal_input_with_real_pty` proves the product launcher uses a real PTY instead of `/usr/bin/script` over pipe stdio. |
| Provider input timing is respected | `runtime_port_splits_composer_text_from_submit_key_when_launch_plan_requests_input_timing` proves launch-plan timing can keep prompt text and submit key separate. |
| Prompt answers preserve provider value | `agent_runtime_port_writes_provider_native_prompt_value_before_ui_choice_id` proves provider-native prompt values are written before Tide UI choice ids. |
| Start Composer values reach selected Agent | `product_shell_antigravity_selection_updates_start_command_launch_options` proves the Antigravity Agent Binding and Launch Options are submitted together, without Codex model defaults. |
| Antigravity transcript becomes visible output | `antigravity_provider_history_reader_projects_planner_response_as_agent_message_frame` proves bounded Antigravity transcript history can produce an agent message frame for the active Thread. |
| User input appears in Agent Session | `starting_ready_thread_records_local_user_message_block_before_runtime_output`, `follow_up_send_records_local_user_message_block`, and `thread_start_contract_events_include_local_user_message_block_before_completion` prove submitted Composer input becomes a local user message block before provider output. |
| Live readiness reads provider files | `live_backend_provider_state_readers_use_local_provider_files` proves local provider-owned files drive auth, onboarding, trust, and bootstrap readiness. |
| Tide API does not use Provider CLI | `provider_readiness_port_reports_provider_account_blocker_for_tide_api_agent` proves `openai_api` gets Provider Account readiness and does not call Provider CLI preflight. |
| Runtime adapter stays outbound | `agent_runtime_wiring_stays_out_of_desktop_and_shared_contracts` prevents concrete runtime wiring from appearing in Desktop or Shared Contracts. |

## Location

- `src/backend/adapters/outbound/agent-runtime/`
- `src/backend/adapters/outbound/provider-readiness/`
- `src/backend/adapters/outbound/pty/`
