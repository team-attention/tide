# Spec: Provider Setup Surface Input And Retry

Status: Superseded by
`docs_v2/specs/thread-workbench-agent-model-cleanup.md`. Active code should use
normal Workbench Terminal Pane input and provider-readiness completion metadata
for retry-preflight behavior.

## Scope

This spec completes the first usable Provider Setup Surface loop after the setup process has been launched.

It covers:

- preserving pending Composer launch options while Provider Readiness is blocked.
- writing terminal bytes to a running Provider Setup Surface Terminal Pane.
- marking the setup Pane completed or failed when the setup process exits.
- re-running Provider Readiness after a setup Pane exits with `retry_preflight`.
- starting or resuming the selected Agent Runtime and replaying the preserved pending Composer input when readiness becomes ready.
- emitting asynchronous Backend events for setup output, setup exit, blocked retry, and successful pending-input replay.

It does not implement a full terminal renderer, terminal screen diffing, provider-specific setup answer automation, or hook/bootstrap file installation.

## Evidence

- `docs_v2/glossary.md` defines Provider Setup Surface as preserving pending Composer input, letting the user complete provider setup, and then re-running Provider Readiness before starting the Thread turn.
- `docs_v2/master-plan.md` says Provider Setup Surface runs the provider's own setup flow and Tide does not reimplement or auto-accept setup choices.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` says Provider Setup Surface input needs terminal input behavior because setup screens may require arrows, Enter, Esc, checkbox toggles, paste prompts, and CSI-u Enter.
- `docs_v2/specs/provider-setup-surface-terminal-lifecycle.md` launches and stops the setup process, leaving terminal input and automatic pending-input replay to this follow-up spec.
- `src/backend/application/services/thread-runtime-service.ts` currently stores pending Composer text, but pending launch options must also survive readiness blockers so Agent/model/permission choices remain source-aware after setup.

## Decisions

### D1. Setup input is raw terminal bytes

The Workbench command writes raw terminal bytes to the visible setup process. Desktop owns key-to-byte mapping for setup UI; Backend only routes the bytes to the setup handle.

### D2. Retry uses preserved launch options

When setup exits and the Pane expects `retry_preflight`, Backend re-runs Provider Readiness with the pending input's preserved launch options. This keeps the selected provider CLI agent and provider-native model/permission values intact.

### D3. Replay starts or resumes the selected Agent Runtime

If readiness becomes ready and pending input exists, Backend starts a new Agent Runtime for a first turn or resumes an existing provider session for a follow-up, then writes the pending Composer input.

### D4. Setup completion is not a second Agent Runtime

The setup process exits independently. It never receives pending Composer input and never becomes the Thread's hidden Agent Runtime.

### D5. Setup exit pushes contract-visible state

Provider Setup Surface output and exit happen after the original `workbench.command` response has returned. Backend must therefore publish asynchronous contract events when the setup Pane changes, when readiness is still blocked, and when pending input is replayed into the selected Agent Runtime.

The events use existing contract kinds: `workbench.changed`, `providerReadiness.changed`, `agentSessionBlock.upserted`, `agentRuntime.stateChanged`, and `thread.hydrated`. No new event kind is required for this slice.

### D6. Desktop renders a live dark terminal surface for input

Desktop renders the Terminal Workbench Pane (including the Provider Setup
Surface) as a live dark xterm terminal that fills the pane. The terminal seeds
from the bounded `transcriptPreview` and then streams live output. Keystrokes
typed into the terminal — line input, arrows, Enter, Esc, and other control keys
(CSI-u included) — are captured by the terminal and routed as raw bytes through
`workbench.command` `write_terminal_input`. There is no separate metadata header
or text-input widget; the terminal itself is the raw-byte input path.

## Flow

### UC-1: Send setup terminal input

1. User focuses the Provider Setup Surface Terminal Pane.
2. Desktop emits `workbench.command` with `write_terminal_input`.
3. Backend validates the target Pane is a running terminal setup Pane.
4. Backend writes the raw terminal bytes to the setup process handle.
5. Pending Composer input remains unchanged.

### UC-2: Retry readiness and replay pending input

1. Setup process exits.
2. Backend marks the setup Pane completed or failed.
3. If the Pane expects `retry_preflight`, Backend re-runs Provider Readiness.
4. If readiness is ready and pending Composer input exists, Backend starts or resumes the selected Agent Runtime with preserved launch options.
5. Backend writes the pending Composer input to the Agent Runtime and clears the pending input only after the write succeeds.
6. Backend emits async state events so Desktop sees the setup Pane completion and replayed Thread turn without requiring a manual hydrate.

### UC-3: Setup exits but readiness still blocked

1. Setup process exits.
2. Backend re-runs Provider Readiness.
3. If readiness is still blocked, Backend leaves pending Composer input intact and does not start Agent Runtime.
4. Backend emits `providerReadiness.changed` and `workbench.changed`.

## Invariants

1. Setup terminal input never writes to Agent Runtime.
2. Pending launch options survive readiness blockers.
3. Pending Composer input is cleared only after replay writes to Agent Runtime.
4. Setup exit with blocked readiness does not start Agent Runtime.
5. Replay uses the Thread's selected Agent Binding; it does not change Agent identity.
6. Asynchronous setup replay events must not fabricate a new Agent Binding, runtime source, model, or permission.

## Tests

| Rule | Test expectation |
|------|------------------|
| Setup input routes to setup handle | `provider_setup_surface_input_writes_terminal_bytes_to_running_setup_process` proves terminal bytes go to the setup process and not Agent Runtime. |
| Launch options survive blocker | `provider_setup_surface_exit_retries_readiness_and_replays_pending_input_when_ready` proves pending launch options are used when retrying and replaying. |
| Blocked retry preserves pending input | `provider_setup_surface_exit_keeps_pending_input_when_readiness_is_still_blocked` proves no Agent Runtime starts if readiness remains blocked. |
| PTY port supports input and exit | `provider_setup_surface_pty_port_forwards_terminal_input_and_exit` proves the live setup port forwards writes and process exit. |
| Setup replay pushes Desktop-visible events | `provider_setup_surface_exit_pushes_async_events_for_replay` proves setup exit emits workbench, submitted block, runtime, and hydrated events after pending input is replayed. |
| Blocked retry pushes readiness | `provider_setup_surface_exit_pushes_async_readiness_when_still_blocked` proves setup exit emits readiness and workbench events when Provider Readiness is still blocked. |
| Desktop renders setup terminal | `provider_setup_terminal_pane_renders_preview_and_input_controls` proves Product Shell renders status, command, transcript preview, and input controls for Terminal Workbench Panes. |
| Desktop emits setup terminal input | `product_shell_setup_terminal_input_emits_workbench_command` proves Product Shell emits `write_terminal_input` with raw bytes for the active setup Pane. |

## Implementation Notes

- Keep terminal byte mapping out of Backend in this slice.
- Keep Provider Setup Surface handles separate from Agent Runtime handles.
- Keep event projection in the live Backend/contract boundary; the Backend service emits domain-level async event facts, not Shared Contract DTOs.
