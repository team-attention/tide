# Spec: Shared Contracts

## Scope

This spec defines the first Shared Contracts slice for the Desktop and Backend boundary.

It covers:

- Contract DTO ownership under `src/shared/contracts`.
- BackendCommand and BackendEvent envelope shapes.
- RequestId correlation.
- Contract Version compatibility.
- Contract Error shape.
- Stream Update behavior.
- Initial DTO families needed by the first product loop.
- Import boundary rules for Desktop, Backend adapters, and Backend domain/services.

It does not implement IPC transport, provider launch behavior, persistence storage, React components, or Electron process wiring.

## Evidence

- `docs_v2/README.md` defines `docs_v2` as the separate product-design workspace for Tide v2 and says v2 terms belong in `docs_v2/glossary.md`.
- `docs_v2/glossary.md` defines Backend as process-separated from Desktop and defines Shared Contracts as serializable message/event contracts crossing that boundary.
- `docs_v2/master-plan.md` sets the product model around Thread, Agent Chat, Composer, hidden Agent Runtime, and optional Workbench.
- `docs_v2/implementation/electron-node-architecture-decisions.md` fixes the source shape with `src/backend`, `src/desktop`, and `src/shared/contracts`.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says Desktop talks to Backend through Shared Contracts, and Backend inbound adapters translate Shared Contract messages into service calls.
- `docs_v2/implementation/concrete-design-backlog.md` selects `src/shared/contracts` as the best option and lists the missing details: command envelope, event envelope, correlation id, error shape, streaming update shape, version policy, and stable versus temporary DTOs.

## Decisions

### D1. Shared Contracts location

Shared Contracts live under:

```text
src/shared/contracts/
```

Desktop may import Shared Contracts.

Backend inbound and outbound adapters may import Shared Contracts.

Backend domain, Backend services, and Backend ports do not import Shared Contracts.

### D2. Contract envelope model

Every BackendCommand crosses the boundary inside a BackendCommandEnvelope.

Every BackendEvent crosses the boundary inside a BackendEventEnvelope.

The envelope carries transport-neutral metadata. The payload carries product-specific state or intent.

### D3. Contract Version policy

The first Contract Version is `1`.

Desktop and Backend reject messages with an unsupported Contract Version before invoking product services.

There is no compatibility negotiation in the first slice. A mismatch is a Contract Error.

### D4. RequestId correlation

Desktop creates a RequestId for every BackendCommand.

Backend copies that RequestId onto every BackendEvent that acknowledges, completes, streams, or fails that command.

BackendEvent values that come from autonomous runtime changes may omit RequestId and must carry their own event id.

### D5. Contract Error shape

Contract Error is a BackendEvent payload, not a thrown object across the boundary.

It includes:

- code.
- message.
- requestId when the error belongs to a command.
- severity.
- retryable.
- details as bounded JSON.

Raw JavaScript Error objects, stack traces, and provider-private raw payloads do not cross by default.

### D6. Stream Update shape

Stream Update is a BackendEvent that upserts or completes a user-visible object by stable id.

The first Stream Update targets are:

- Agent Runtime state.
- Provider Readiness state.
- prompt state.
- Agent Session Block.
- Workbench Pane state.

The first slice defines the envelope and target pattern. Later specs define the full payload for each target.

### D7. Stable and temporary DTO split

Stable product Contract DTOs:

- Thread metadata summary.
- Agent Binding.
- Provider Readiness.
- prompt state.
- Agent Runtime state.
- Agent Session Block summary.
- Workbench Pane reference.

Temporary implementation Contract DTOs:

- raw Provider Signal diagnostics.
- raw PTY Transcript diagnostics.
- debug-only Agent Integration capability observations.

Temporary DTOs must be marked as diagnostic or experimental in their type name or payload kind.

## Out Of Scope

- Choosing MessagePort, Main-routed IPC, stdio, or another transport.
- Provider-specific launch flags and resume flags.
- Provider-specific prompt grammar.
- Real Agent Session Block reader implementation.
- Thread persistence format.
- Browser Pane automation tool details.
- UI component props.
- Packaging or dependency management.

## Domain Model

### BackendCommand

BackendCommand is a Contract DTO sent by Desktop to Backend.

Initial command kinds:

| Kind | Purpose |
|------|---------|
| `thread.hydrate` | Open an existing Thread and request current render/runtime metadata. |
| `thread.start` | Create a new Thread and start its first Agent Runtime turn. |
| `agentRuntime.resume` | Resume a Thread's provider-owned Raw Agent Session in a hidden Agent Runtime. |
| `composer.sendInput` | Send Follow-up Composer input to the active Agent Runtime. |
| `prompt.answer` | Answer a provider question, approval, permission, choice, or command picker. |
| `agentRuntime.stop` | Ask Backend to stop the active Agent Runtime for a Thread. |
| `workbench.command` | Request a Tide-owned Workbench action. Detailed tool payloads are specified later. |

### BackendEvent

BackendEvent is a Contract DTO sent by Backend to Desktop.

Initial event kinds:

| Kind | Purpose |
|------|---------|
| `command.accepted` | Backend accepted a BackendCommand envelope for processing. |
| `command.completed` | A command completed without needing a richer event kind. |
| `contract.error` | A command or autonomous runtime action failed in a serializable form. |
| `thread.hydrated` | Backend returned Thread metadata and cached Agent Session state. |
| `thread.started` | Backend created or started a Thread. |
| `agentRuntime.stateChanged` | Agent Runtime state changed. |
| `providerReadiness.changed` | Provider Readiness changed. |
| `prompt.changed` | A prompt became active, changed, or cleared. |
| `agentSessionBlock.upserted` | A renderable Agent Session Block was created or updated. |
| `agentSessionBlock.completed` | A streaming Agent Session Block became complete or failed. |
| `workbench.changed` | Workbench state changed. |

### RequestId

RequestId is opaque to Backend services.

It exists only for correlation at the contract boundary.

### Contract DTO

A Contract DTO must be JSON-serializable:

- strings, numbers, booleans, null.
- arrays and plain objects.
- ISO timestamp strings.
- provider-native strings when Tide displays provider-owned values.

A Contract DTO must not contain:

- functions.
- class instances.
- Error objects.
- Date objects.
- cyclic object graphs.
- Node handles, PTY objects, file descriptors, WebContents, or BrowserWindow references.

## Contracts

### Envelope types

```ts
export type ContractVersion = 1;
export type RequestId = string;
export type BackendEventId = string;

export interface BackendCommandEnvelope<TKind extends BackendCommandKind = BackendCommandKind> {
  contractVersion: ContractVersion;
  requestId: RequestId;
  kind: TKind;
  issuedAt: string;
  payload: BackendCommandPayloadByKind[TKind];
}

export interface BackendEventEnvelope<TKind extends BackendEventKind = BackendEventKind> {
  contractVersion: ContractVersion;
  eventId: BackendEventId;
  requestId?: RequestId;
  kind: TKind;
  emittedAt: string;
  payload: BackendEventPayloadByKind[TKind];
}
```

### Contract Error

```ts
export type ContractErrorCode =
  | "unsupported_contract_version"
  | "invalid_command"
  | "invalid_event"
  | "unknown_command"
  | "thread_not_found"
  | "provider_not_ready"
  | "agent_runtime_unavailable"
  | "provider_runtime_failed"
  | "workbench_target_not_found"
  | "internal_error";

export interface ContractErrorPayload {
  code: ContractErrorCode;
  message: string;
  severity: "info" | "warning" | "error";
  retryable: boolean;
  details?: JsonObject;
}
```

### Common identity DTOs

```ts
export type ThreadId = string;
export type ProjectId = string;
export type WorkbenchPaneId = string;

export type AgentId = "codex" | "claude" | "antigravity";

export interface AgentBindingDto {
  agentId: AgentId;
  providerSessionRef?: ProviderSessionRefDto;
}

export interface ProviderSessionRefDto {
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "antigravity_conversation"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
}
```

### Thread metadata summary

```ts
export interface ThreadSummaryDto {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBindingDto;
  scope: ThreadScopeDto;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  lastKnownState: LastKnownStateDto;
}

export type ThreadScopeDto =
  | { kind: "project"; projectId: ProjectId; cwd: string }
  | { kind: "scratch"; scratchCwd: string };

export type LastKnownStateDto =
  | "idle"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "failed"
  | "archived";
```

### Runtime and readiness summaries

```ts
export type AgentRuntimeStateDto =
  | "not_started"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed";

export interface ProviderReadinessDto {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlockerDto[];
}

export interface ProviderReadinessBlockerDto {
  kind:
    | "not_installed"
    | "not_authenticated"
    | "onboarding_required"
    | "directory_trust_required"
    | "hook_bootstrap_required"
    | "unknown";
  message: string;
  action?: "open_terminal" | "open_provider" | "retry" | "none";
}
```

### Prompt state summary

```ts
export type PromptKindDto =
  | "question"
  | "approval"
  | "permission"
  | "choice"
  | "command_picker";

export interface PromptStateDto {
  promptId: string;
  threadId: ThreadId;
  agentId: AgentId;
  kind: PromptKindDto;
  message: string;
  choices?: PromptChoiceDto[];
  defaultChoiceId?: string;
  source: "pty" | "provider_signal" | "provider_hook";
}

export interface PromptChoiceDto {
  choiceId: string;
  label: string;
  providerValue: string;
}
```

### Agent Session Block summary

The full Agent Session Block schema is owned by the Agent Session Block rendering path spec.

Shared Contracts first define the minimum stream target shape:

```ts
export interface AgentSessionBlockDto {
  blockId: string;
  threadId: ThreadId;
  kind: string;
  status: "pending" | "streaming" | "complete" | "failed" | "needs_input";
  updatedAt: string;
  body?: string;
  data?: JsonObject;
}
```

### Workbench reference summary

The full Tide MCP Tool Surface spec owns Workbench command/result details.

Shared Contracts first define references:

```ts
export interface WorkbenchPaneRefDto {
  paneId: WorkbenchPaneId;
  kind: "browser" | "diff" | "editor" | "terminal";
  title: string;
  visible: boolean;
  updatedAt: string;
}
```

## Flow

### UC-1: Desktop sends a command

1. Desktop creates a BackendCommandEnvelope with Contract Version `1`, RequestId, kind, issuedAt, and payload.
2. The transport forwards the envelope to Backend.
3. Backend inbound adapter validates Contract Version and basic payload shape.
4. Backend inbound adapter maps the command payload into a Backend service call.
5. Backend emits `command.accepted` with the same RequestId after validation succeeds.
6. Backend emits command-specific BackendEvent values as work progresses.
7. Backend emits `command.completed` or `contract.error` with the same RequestId.

### UC-2: Backend emits autonomous runtime updates

1. Agent Runtime or Provider Signals produce a Backend state change.
2. Backend service updates its internal model.
3. Backend outbound adapter maps the change into a BackendEventEnvelope.
4. If the update belongs to a command, Backend includes RequestId.
5. If the update is autonomous, Backend omits RequestId and relies on eventId plus domain ids.

### UC-3: Desktop receives Stream Updates

1. Desktop receives a BackendEventEnvelope.
2. Desktop rejects unsupported Contract Version.
3. Desktop routes by event kind.
4. Desktop upserts the target object by stable id.
5. Desktop keeps event ordering local to the target object, not as a global UI lock.

## Invariants

1. Every BackendCommandEnvelope and BackendEventEnvelope has Contract Version `1`.
2. Every BackendCommandEnvelope has a RequestId.
3. Every command-scoped BackendEvent carries the command's RequestId.
4. Every BackendEvent has an eventId.
5. Contract DTOs are JSON-serializable plain data.
6. Backend domain, Backend services, and Backend ports do not import from `src/shared/contracts`.
7. Desktop does not import from `src/backend`.
8. Provider-native values that users see remain provider-native strings.
9. Stream Updates target stable ids so Desktop can coalesce or replay them.
10. Contract Error payloads do not expose raw Error objects across the boundary.

## Tests

Test file:

```text
tests/shared-contracts.test.ts
```

The first slice uses Node's built-in test runner so Shared Contracts can be verified before the full Electron/Vitest build scaffold exists.

| Rule | Test expectation |
|------|------------------|
| BackendCommandEnvelope requires Contract Version `1` | A validator accepts version `1` and rejects unsupported versions with `unsupported_contract_version`. |
| BackendCommandEnvelope requires RequestId | A command without RequestId is rejected before reaching Backend services. |
| BackendEventEnvelope requires eventId | An event without eventId is rejected by Desktop-side validation. |
| Command-scoped events preserve RequestId | A fake command produces accepted, stream, and completed events with the same RequestId. |
| Contract Error is serializable | A Contract Error payload round-trips through JSON without Error objects or stack references. |
| Stream Updates target stable ids | Replaying two `agentSessionBlock.upserted` events for the same blockId produces one updated UI record in a reducer test. |
| Backend domain, services, and ports do not import Shared Contracts | Architecture boundary test fails if `src/backend/domain`, `src/backend/services`, `src/backend/ports`, or their `src/backend/application/*` equivalents import `src/shared/contracts`. |
| Desktop does not import Backend internals | Architecture boundary test fails if `src/desktop` imports `src/backend`. |
| Provider-native values are preserved | Prompt choice DTO keeps providerValue unchanged while allowing a display label. |

## Implementation Notes

- Create `src/shared/contracts/index.ts` as the public export surface.
- Split contract families by file only when the first implementation needs it; avoid deep folders before the contract grows.
- Implement small explicit runtime validators for the envelope and common primitives in the first slice.
- Keep mapping code in Backend adapters, not in Backend domain/services.
- Keep React state reducers on the Desktop side separate from Contract DTO definitions.
- Use ISO timestamp strings at the boundary.
- Use opaque string ids for RequestId, eventId, ThreadId, ProjectId, promptId, blockId, and WorkbenchPaneId.
- Add architecture boundary tests in this slice using bounded source scanning.
- Do not add alternate provider transports or provider-specific fallback command paths in this spec.
