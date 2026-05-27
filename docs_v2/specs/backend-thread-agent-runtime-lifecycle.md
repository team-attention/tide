# Spec: Backend Thread and Agent Runtime Lifecycle

## Scope

This spec defines the Backend product model for Thread lifecycle, Agent Runtime lifecycle, prompt handling, Raw Agent Frame ordering, Agent Session Block updates, and Tide MCP Tool Surface service entrypoints.

It covers:

- Backend hexagonal core responsibilities.
- Thread lifecycle states.
- Agent Runtime State transitions.
- Provider Readiness gate before runtime input.
- Prompt State for question, approval, permission, choice, and command picker.
- Raw Agent Frame ordering.
- Agent Session Block update ownership.
- Tide MCP tool call routing into Backend services.

It does not define provider-specific CLI launch details, Electron process lifecycle, Desktop UI layout, persistence format, or real Workbench tool DTOs.

The first implementation covers an executable Backend application service with in-memory Thread records and fake outbound ports. It proves lifecycle behavior before real provider, PTY, persistence, Electron, or Desktop adapters are added.

## Evidence

- `docs_v2/glossary.md` defines Thread as the user-facing work conversation and Agent Runtime as a hidden PTY-backed provider CLI process.
- `docs_v2/glossary.md` defines Backend as the process-separated owner of Agent Runtime lifecycle, Provider Readiness, Provider Signals, PTY Transcript capture, provider-owned session references, and Agent Session Block production.
- `docs_v2/master-plan.md` says Agent Runtime is an internal execution detail and users normally interact with Agent Chat and Agent Session.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says opening an existing Thread hydrates from provider-owned history and Tide render cache without starting Agent Runtime.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says sending a message starts or resumes the Thread's Agent Runtime and keeps it alive until window close, explicit stop, provider exit, or visible recovery restart.
- `docs_v2/implementation/concrete-design-backlog.md` selects a Backend hexagonal core and lists Thread lifecycle states, Agent Runtime lifecycle states, prompt states, Raw Agent Frame ordering, Agent Session Block identity, and Tide MCP tool routing as required details.
- `docs_v2/research/agent-hidden-pty-provider-signal-smoke.md` says Provider Readiness must be satisfied before user input is sent to a real Thread turn because setup screens can capture Composer bytes before conversation input.
- `src/shared/contracts/` already defines Shared Contract DTOs for Thread metadata, Agent Binding, Provider Readiness, Prompt State, Agent Runtime State, Agent Session Block, and Backend command/event envelopes.
- `tests/shared-contracts.test.ts` uses Node's built-in test runner with `--experimental-strip-types` and already enforces Backend application independence from Shared Contracts.

## Decisions

### D1. Backend owns runtime state

Desktop sends user intent.

Backend owns Thread runtime state, Agent Runtime State, Provider Readiness, Prompt State, PTY Transcript capture, Raw Agent Frames, and Agent Session Block production.

### D2. Hydration does not start runtime

Opening an existing Thread hydrates Thread metadata and cached Agent Session state.

Hydration may read provider-owned Raw Agent Session history or Tide-owned Agent Session Cache later, but it does not start Agent Runtime by default.

### D3. Sending input starts or resumes runtime

The first meaningful Start Composer input creates a Thread and starts its Agent Runtime.

Follow-up Composer input starts or resumes the Agent Runtime when needed.

### D4. Provider Readiness gates user input

Backend checks Provider Readiness before sending Start Composer or Follow-up Composer input into a real Agent Runtime.

If readiness is incomplete, Backend emits Provider Readiness and Prompt State events and preserves the user's input as pending command state. It does not write the input into the hidden PTY.

### D5. Agent Binding is locked after Thread start

Thread creation attaches one Agent Binding.

Follow-up Composer input uses that Agent Binding.

Changing the Agent for an existing Thread is outside this spec.

### D6. Agent Runtime State is separate from Last Known State

Agent Runtime State describes the live process.

Last Known State is Thread metadata used for reopen, attention UI, and sorting.

When no Agent Runtime is active, a Thread can still have a Last Known State such as idle, failed, waiting for input, or archived.

### D7. Prompt State belongs to Backend

Provider questions, approvals, permissions, choices, and command pickers become Prompt State in Backend.

Desktop presents active Prompt State at the Composer or active input surface.

Agent Session rendering may also record the prompt as narrative history.

### D8. Raw Agent Frames are ordered per Thread

Backend assigns a monotonic sequence to each Raw Agent Frame within a Thread observation stream.

Agent-specific readers use that sequence to produce Agent Session Block updates.

### D9. Tide MCP calls route through Backend services

Tide MCP Tool Surface calls enter Backend through an inbound adapter and call Backend services.

They call Backend services as the mutation path and share the existing Agent Runtime session.

### D10. First implementation is service-local and fake-port backed

This slice implements the Backend application service under `src/backend/application/`.

The service keeps Thread records, active runtime handles, pending prompt state, and Raw Agent Frame sequence counters in memory. This is test scaffolding for the lifecycle model, not the persistence design.

Tests provide fake Agent Runtime, Provider Readiness, and PTY Transcript ports. Real Agent Integrations, real hidden PTYs, Provider Signal readers, and Thread persistence belong to later specs.

## Out Of Scope

- Codex, Claude, or Antigravity launch/resume flags.
- Hook payload examples per provider.
- Agent Integration bootstrap and readiness implementation.
- Electron utilityProcess lifecycle.
- MessagePort or IPC handshake.
- React UI state and components.
- Persistent storage format.
- Browser Pane page map and action DTOs.
- Backend/Desktop contract adapter wiring.
- Electron utilityProcess startup and reconnect behavior.

## Domain Model

### Thread

Thread is the aggregate that connects user-facing work identity to one Agent Binding and one provider-owned Raw Agent Session reference when available.

The first implementation stores Thread metadata in a service-local map keyed by Thread id. A stored Thread has one Agent Binding after start, a lifecycle state, a Last Known State, optional cached Agent Session Blocks, optional active Prompt State, and optional active Agent Runtime handle.

Backend Thread lifecycle states:

| State | Meaning |
|-------|---------|
| `draft` | Desktop has a Composer draft but Backend has not created a persistent Thread. Backend normally does not store this state. |
| `creating` | Backend accepted a start command and is preparing Thread metadata and Execution Context. |
| `hydrating` | Backend is loading Thread metadata, render cache, or provider-owned Raw Agent Session history. |
| `open` | Thread is visible and hydrated, with no active turn running. |
| `running` | Thread has an active Agent Runtime turn. |
| `waiting_for_input` | Provider requires a question, choice, or command picker answer. |
| `waiting_for_approval` | Provider requires approval or permission. |
| `failed` | Thread reached a recoverable or inspectable failure state. |
| `archived` | Thread is hidden from default active lists but remains reopenable. |

### Agent Runtime

Agent Runtime is the live hidden PTY-backed provider process for one Thread.

Agent Runtime State values:

| State | Meaning |
|-------|---------|
| `not_started` | No provider process is active for the Thread. |
| `starting` | Backend is launching or resuming the provider process. |
| `running` | Provider process is active and handling a turn. |
| `waiting_for_input` | Provider process is active and needs a non-approval user answer. |
| `waiting_for_approval` | Provider process is active and needs approval or permission. |
| `idle` | Provider process is active and ready for follow-up input. |
| `stopping` | Backend requested stop. |
| `stopped` | Provider process is no longer active after an intentional stop or normal exit. |
| `failed` | Provider process failed or became unusable. |

### Prompt State

Prompt State represents a provider-owned interaction that needs user action.

Prompt kinds:

- question.
- approval.
- permission.
- choice.
- command picker.

Prompt State is cleared when Backend confirms that the user's answer has been accepted by the same Agent Runtime session.

### Raw Agent Frame

Raw Agent Frame is an ordered observed unit from PTY Transcript, Provider Signals, provider logs, provider history, stdout/stderr, or hook payloads.

Frame identity:

- frame id.
- Thread id.
- Agent id.
- source.
- source reference.
- sequence.
- observed timestamp.

### Agent Session Block Reference

This spec only requires Backend to emit Agent Session Block update events by stable block id.

The full block schema belongs to `agent-session-block-rendering-path.md`.

## Contracts

Backend services expose behavior, not Shared Contract DTOs.

Suggested service methods:

```ts
interface ThreadRuntimeService {
  hydrateThread(input: HydrateThreadInput): Promise<HydrateThreadResult>;
  startThread(input: StartThreadInput): Promise<StartThreadResult>;
  sendComposerInput(input: SendComposerInput): Promise<SendComposerInputResult>;
  answerPrompt(input: AnswerPromptInput): Promise<AnswerPromptResult>;
  stopAgentRuntime(input: StopAgentRuntimeInput): Promise<StopAgentRuntimeResult>;
  handleTideMcpToolCall(input: TideMcpToolCallInput): Promise<TideMcpToolCallResult>;
}
```

Required outbound ports:

```ts
interface AgentRuntimePort {
  start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle>;
  resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle>;
  writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void>;
  stop(handle: AgentRuntimeHandle): Promise<void>;
}

interface ProviderReadinessPort {
  check(input: ProviderReadinessCheckInput): Promise<ProviderReadinessResult>;
}

interface ProviderSignalPort {
  attach(input: ProviderSignalAttachInput): Promise<ProviderSignalSubscription>;
}

interface PtyTranscriptPort {
  append(frame: RawAgentFrame): Promise<void>;
}
```

The first implementation may use fake ports. Real provider ports are specified by the Provider Integration Bootstrap spec.

## Flow

### UC-1: Hydrate existing Thread

1. Desktop sends `thread.hydrate`.
2. Backend loads Thread metadata.
3. Backend loads cached Agent Session state when available.
4. Backend emits `thread.hydrated`.
5. Agent Runtime State remains `not_started` unless a runtime was already active.

### UC-2: Start Thread from Start Composer

1. Desktop sends `thread.start` with first meaningful user input and Launch Options.
2. Backend creates Thread metadata and Agent Binding.
3. Backend checks Provider Readiness.
4. If readiness is incomplete, Backend emits Provider Readiness and does not write user input to PTY.
5. If readiness is complete, Backend starts Agent Runtime.
6. Backend writes Composer input through terminal input semantics.
7. Backend captures Raw Agent Frames and emits Agent Session Block updates.

### UC-3: Send Follow-up Composer input

1. Desktop sends `composer.sendInput`.
2. Backend resolves the Thread and Agent Binding.
3. Backend checks Provider Readiness for the current Execution Context.
4. Backend starts or resumes Agent Runtime if needed.
5. Backend writes the input to the same Agent Runtime session.
6. Backend emits state and block updates.

### UC-4: Answer active Prompt State

1. Backend has active Prompt State for a Thread.
2. Desktop sends `prompt.answer`.
3. Backend routes the answer through the same Agent Runtime session unless a provider hook response path is explicitly proven and tied to that session.
4. Backend clears Prompt State after provider acceptance.
5. Backend emits `prompt.changed` and Agent Session Block updates.

### UC-5: Stop Agent Runtime

1. Desktop sends `agentRuntime.stop`.
2. Backend asks AgentRuntimePort to stop the active handle.
3. Backend records final PTY Transcript evidence.
4. Backend updates Agent Runtime State to `stopped` or `failed`.
5. Thread remains reopenable.

### UC-6: Route Tide MCP tool call

1. Agent calls a Tide MCP tool attached to the same provider CLI session.
2. Backend MCP inbound adapter validates the tool call and Thread identity.
3. Backend calls the relevant service method.
4. Backend emits Workbench or Agent Session updates as needed.
5. Tool result returns to the provider through the MCP response path.

## Invariants

1. Backend domain/services own Agent Runtime State.
2. Desktop Renderer does not spawn Agent Runtime processes or PTYs.
3. Hydrating a Thread does not start Agent Runtime by default.
4. Backend checks Provider Readiness before sending user input to a real Agent Runtime.
5. A Thread has one Agent Binding after start.
6. A Thread has at most one active Agent Runtime handle for its Agent Binding.
7. Prompt State is answered through the same Agent Runtime session unless a provider-supported hook response path is proven.
8. Raw Agent Frame sequence increases monotonically per Thread observation stream.
9. Agent Session Block updates retain provenance to Raw Agent Frames once the rendering spec defines full provenance fields.
10. Tide MCP tool calls route through Backend services as the domain mutation path.

## Tests

Test file:

```text
tests/backend-thread-agent-runtime-lifecycle.test.ts
```

| Rule | Test expectation |
|------|------------------|
| Hydration keeps runtime inactive | `hydrating_an_existing_thread_does_not_start_or_resume_an_agent_runtime` seeds a Thread, hydrates it, returns metadata, and leaves AgentRuntimePort.start and resume unused. |
| Start checks readiness first | `starting_a_thread_with_incomplete_provider_readiness_preserves_pending_input_without_writing_to_runtime` starts a Thread with incomplete Provider Readiness, records pending input, and leaves AgentRuntimePort.writeInput unused. |
| Start launches runtime when ready | `starting_a_thread_with_ready_provider_starts_runtime_then_writes_terminal_input` starts a Thread with ready Provider Readiness, calls AgentRuntimePort.start, then writeInput through terminal input. |
| Follow-up resumes when needed | `sending_follow_up_input_to_an_open_thread_resumes_before_writing` sends Composer input to an open Thread with no active runtime and calls AgentRuntimePort.resume before writeInput. |
| Agent Binding is locked | `sending_follow_up_input_with_a_different_agent_binding_is_rejected` rejects follow-up input that attempts to use a different Agent id. |
| Prompt answer uses same runtime | `answering_an_active_prompt_writes_to_the_same_runtime_and_clears_prompt_state` writes the answer to the active runtime handle and clears Prompt State. |
| Stop preserves Thread | `stopping_agent_runtime_preserves_thread_metadata` stops the active handle and changes runtime state without deleting Thread metadata. |
| Raw Agent Frame ordering is monotonic | `raw_agent_frames_receive_monotonic_thread_local_sequences` appends fake runtime frames and assigns increasing sequence values for one Thread. |
| MCP tool call uses service path | `mcp_tool_calls_are_counted_by_the_service_without_creating_a_second_runtime` routes a fake MCP tool call through the service and leaves AgentRuntimePort.start and resume unused. |
| Backend application stays inside its boundary | `backend_application_does_not_import_shared_contracts_or_adapters` verifies Backend application files stay independent from Shared Contracts, Backend adapters, Backend infrastructure, Electron, React, and Node IO modules. |

## Implementation Notes

- Implement this slice with fake AgentRuntimePort, fake ProviderReadinessPort, and fake ProviderSignalPort first.
- Keep Backend domain types separate from Shared Contracts DTOs.
- Put Shared Contract mapping in Backend inbound/outbound adapters.
- Use terminal input semantics for user input in the real provider path.
- Keep Provider Readiness blockers visible to Desktop and preserve pending user input until the provider is ready.
- Keep active runtime limits out of the first implementation.
- Use one runtime transport for each Agent in this lifecycle slice.
