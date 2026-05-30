# Spec: Backend/Desktop Process Connection

## Scope

This spec defines how Desktop Main, Desktop Renderer, and Backend connect in Tide v2.

It covers:

- Backend process ownership.
- Desktop Main supervision.
- Renderer to Backend command/event connection.
- handshake.
- reconnect after Renderer reload.
- Backend crash behavior.
- app close behavior.
- active Agent Runtime shutdown behavior.
- bounded event buffering.

It does not define Backend domain lifecycle, provider launch details, Shared Contract payload internals, React UI, or packaging.

The implemented path covers the process boundary in two layers:

- Shared Contract connection DTOs.
- a Backend inbound Contract Message Adapter for BackendCommand envelopes.
- a Desktop outbound MessagePort-compatible Backend client for testable transport seams.
- a Desktop Main supervisor state machine with fake Backend process seams.
- Electron Main spawning the built Backend entrypoint with `utilityProcess.fork`.
- Electron Main brokering Renderer IPC commands to Backend utilityProcess messages.
- Electron Main forwarding unprompted BackendEvent envelopes, such as Agent Session Block stream updates, to Renderer windows.

## Evidence

- `docs_v2/implementation/electron-node-architecture-decisions.md` says Tide v2 uses Electron + React for Desktop and a process-separated Node Backend for Agent Runtime ownership.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says Desktop Main supervises Backend process and should not become the Agent Runtime implementation.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says Desktop Renderer should not own provider processes or PTYs because it can reload, crash, or slow down.
- `docs_v2/implementation/electron-node-architecture-decisions.md` says the initial model is Renderer to Main to Backend, with a preferred streaming model where Renderer and Backend communicate through direct MessagePort after Main creates the connection.
- `docs_v2/implementation/concrete-design-backlog.md` selects Electron utilityProcess Backend and lists spawn protocol, connection protocol, reconnect, crash, app close, shutdown, and buffering as required details.
- `package.json` currently exposes `test:v2` through Node's built-in test runner and does not include Electron or electron-vite dependencies.
- Existing v2 source already contains `src/shared/contracts`, Backend application services, Desktop React adapter code, and no Desktop infrastructure process supervisor.

## Decisions

### D1. Backend is an Electron utilityProcess

Desktop Main starts Backend as a Node-capable Electron utilityProcess.

Backend owns Agent Runtime processes and PTYs.

### D2. Main is supervisor and broker

Desktop Main owns:

- Backend process spawn.
- Backend process health.
- window lifecycle.
- initial handshake.
- connection brokering between Renderer and Backend.

Desktop Main does not implement Thread lifecycle, Agent Runtime lifecycle, provider logic, or Agent Session Block production.

### D3. Renderer uses Shared Contracts only

Desktop Renderer sends BackendCommand envelopes and receives BackendEvent envelopes.

Renderer does not import Backend internals and does not call Node PTY or child process APIs.

### D4. Direct MessagePort is the product data plane

After handshake, Renderer communicates with Backend through a direct MessagePort brokered by Main.

The first product path does not define a second live command/event transport.

Tests may use an in-memory fake transport, but product behavior is MessagePort after handshake.

### D5. Backend sends snapshots after reconnect

After Renderer reload or reconnect, Backend sends current Thread, Agent Runtime, Provider Readiness, Prompt State, Workbench, and Agent Session Block snapshot events for the active Thread.

Backend does not replay the raw PTY firehose to rebuild React state.

### D6. Backend crash is visible recovery

If Backend exits unexpectedly, Main marks Backend disconnected and notifies Renderer.

Main may start a fresh Backend process, but active Agent Runtime handles from the crashed Backend are treated as lost until Backend hydrates Thread metadata and the user explicitly resumes or sends follow-up.

### D7. App close is graceful shutdown

When the app window closes or app quits, Main asks Backend to stop active Agent Runtimes and flush bounded transcript/cache metadata.

If graceful shutdown times out, Main may terminate Backend and the next open uses provider-owned history and Tide metadata for recovery.

### D8. Event buffering is bounded by product state

Backend keeps enough event/state buffer to reconnect Renderer to current Thread state.

Backend does not keep unbounded event history in memory.

Raw PTY evidence belongs to PTY Transcript and provider history, not Renderer replay buffers.

### D9. Process seams stay testable, product Main uses utilityProcess

The code keeps fake Backend process handles and MessagePort-compatible ports for state-machine tests.

This proves the command/event path, handshake validation, reconnect snapshot, crash visibility, and shutdown ordering under Node tests.

The product Electron Main path also starts the built Backend entrypoint with `utilityProcess.fork`, validates the Backend handshake, posts BackendCommand envelopes, collects command-scoped BackendEvent envelopes, and resolves the Renderer IPC request when the Backend emits `command.completed` or `contract.error`.

BackendEvent envelopes that are not scoped to the current IPC request are pushed to Renderer windows over the `tide:backend-event` channel so Agent Runtime stream updates remain visible after the command returns.

If Backend emits an unscoped event while an IPC command is still being handled, the Backend entrypoint buffers that event until after the command-scoped events are posted. Main also keeps request-independent events on the pushed event channel. This preserves the push channel for runtimes that produce their first Agent output inside the command path, without requiring Desktop to recover the update through a later hydrate.

Desktop Main still does not import Backend internals. The backend entrypoint path is a process target string and a built JS file path, not a source import.

## Out Of Scope

- Exact Electron API call sites.
- Native PTY dependency packaging.
- Provider process implementation.
- Persistence schema.
- UI disconnected screen styling.
- Multi-window behavior.
- Background daemon behavior after all windows close.

## Domain Model

### Desktop Main

Desktop Main is the Electron process responsible for app/window lifecycle and Backend process supervision.

Main-owned state:

- Backend process handle.
- Backend connection health.
- Renderer window identity.
- MessagePort broker state.

### Backend Process

Backend process is the Node-capable process that owns:

- Backend domain/services.
- Agent Runtime handles.
- Provider Signal subscriptions.
- PTY Transcript capture.
- Agent Session Block production.
- Tide MCP Tool Surface service routing.

### Desktop Renderer

Desktop Renderer owns:

- React UI.
- Agent Chat presentation.
- Composer UI.
- Workbench UI.
- UI reducers over BackendEvent envelopes.

### Connection State

Connection state values:

| State | Meaning |
|-------|---------|
| `starting` | Main is starting Backend. |
| `handshaking` | Main and Backend are exchanging protocol metadata and port setup. |
| `connected` | Renderer has active command/event data plane to Backend. |
| `renderer_reconnecting` | Renderer reloaded or lost the port while Backend remains alive. |
| `backend_disconnected` | Backend exited or failed health check. |
| `shutting_down` | App close or quit is stopping Backend. |

## Contracts

Handshake metadata:

```ts
interface BackendHandshake {
  contractVersion: 1;
  backendInstanceId: string;
  startedAt: string;
  supportedTransports: ["message_port"];
}

interface RendererHandshake {
  contractVersion: 1;
  rendererInstanceId: string;
  activeThreadId?: string;
}
```

Connection lifecycle events:

```ts
type DesktopConnectionEvent =
  | { kind: "backend.connectionChanged"; state: ConnectionState; backendInstanceId?: string }
  | { kind: "backend.snapshotRequested"; activeThreadId?: string }
  | { kind: "backend.snapshotReady"; activeThreadId?: string };
```

These lifecycle events may be represented as BackendEvent envelopes where they cross the Renderer/Backend boundary.

First implementation contract additions:

- `ConnectionState` and handshake DTOs live in Shared Contracts.
- `backend.connectionChanged`, `backend.snapshotRequested`, and `backend.snapshotReady` are BackendEvent kinds.
- Desktop outbound adapters validate BackendCommand envelopes before posting to the process data plane.
- Desktop inbound event listeners validate BackendEvent envelopes before handing them to Desktop application code.

## Flow

### UC-1: App starts Backend

1. Desktop Main starts.
2. Main spawns Backend utilityProcess.
3. Backend sends handshake metadata.
4. Main verifies Contract Version.
5. Main brokers MessagePort between Renderer and Backend.
6. Renderer sends current active Thread id if any.
7. Backend sends initial snapshot events.

### UC-2: Renderer sends command

1. Renderer creates BackendCommand envelope.
2. Renderer sends it over MessagePort.
3. Backend inbound adapter validates envelope.
4. Backend service handles command.
5. Backend sends BackendEvent envelopes over the same MessagePort.

### UC-3: Renderer reloads

1. Renderer loses MessagePort.
2. Backend continues owning Agent Runtime and consuming PTY output.
3. Main brokers a new MessagePort to the new Renderer.
4. Renderer sends active Thread id.
5. Backend emits snapshot events and then resumes streaming updates.

### UC-4: Backend crashes

1. Main observes Backend exit or failed health.
2. Main marks connection `backend_disconnected`.
3. Renderer shows visible recovery state.
4. Main starts a fresh Backend process when appropriate.
5. Fresh Backend hydrates metadata but does not silently claim lost runtime handles.

### UC-5: App closes

1. Main sends shutdown request to Backend.
2. Backend stops active Agent Runtimes.
3. Backend flushes bounded transcript/cache metadata.
4. Backend exits.
5. Main quits app.

## Invariants

1. Backend is process-separated from Desktop Renderer.
2. Renderer does not spawn provider processes or PTYs.
3. Main does not implement Agent Runtime logic.
4. Product command/event data plane is MessagePort after handshake.
5. Shared Contracts are the only data shape crossing Renderer and Backend.
6. Renderer reconnect receives snapshots, not raw PTY replay.
7. Backend crash results in visible recovery state.
8. App close asks Backend for graceful shutdown before termination.
9. Event buffering is bounded and state-oriented.
10. Browser-only Renderer previews must surface missing Backend transport instead of silently dropping commands.
11. Unscoped Backend events emitted during a pending command must still reach Renderer through the pushed event channel after the command resolves.

## Tests

| Rule | Test expectation |
|------|------------------|
| UC-1 BR-1: Main starts Backend | `main_starts_backend_and_brokers_contract_handshake` records one Backend spawn, validates handshake, and emits connected state. |
| UC-1 BR-2: Contract mismatch fails handshake | `unsupported_contract_version_fails_handshake_before_command_handling` marks Backend disconnected and posts a Contract Error before any command handling. |
| UC-2 BR-1: Renderer sends only BackendCommand envelopes | `message_port_backend_client_rejects_non_envelope_payloads` rejects non-envelope payloads before transport post. |
| UC-2 BR-2: Commands cross through Shared Contracts | `renderer_command_reaches_backend_adapter_and_returns_backend_events` posts a BackendCommand envelope and receives BackendEvent envelopes with the same RequestId. |
| UC-2 BR-3: Product Shell selections reach Backend runtime unchanged | `product_shell_thread_start_command_reaches_backend_with_selected_agent_binding` submits the Product Shell Antigravity start command through the Backend Contract adapter and verifies Provider Readiness, Agent Runtime start, and terminal input all use the selected Agent Binding and Launch Options. |
| UC-3 BR-1: Renderer reconnect gets snapshot | `renderer_reconnect_receives_active_thread_snapshot` reconnects with active Thread id and receives snapshot lifecycle plus Thread hydration events. |
| UC-3 BR-2: Backend continues while Renderer reloads | `backend_keeps_runtime_events_while_renderer_is_disconnected` records Backend runtime observations during disconnect and sends current snapshot on reconnect. |
| UC-4 BR-1: Backend crash is visible | `backend_crash_emits_disconnected_state_without_survived_runtime_claim` emits Backend disconnected state and marks runtime handles as lost. |
| UC-5 BR-1: App close requests shutdown | `app_close_requests_backend_shutdown_before_terminate_path` sends graceful shutdown before terminate fallback. |
| Architecture BR-1: Main has no runtime logic | `desktop_main_supervisor_does_not_import_provider_or_pty_modules` prevents provider/PTY modules from being imported by Desktop Main runtime supervisor. |
| Architecture BR-2: Product Main uses process boundary | `electron_main_uses_utility_process_for_backend_without_importing_backend_internals` proves Electron Main forks the Backend entrypoint, validates Shared Contract messages, and does not import Backend internals. |
| UC-2 BR-4: Runtime events stream after command return | `electron_main_and_preload_expose_backend_event_push_channel` proves Main sends unprompted BackendEvents and Preload exposes a subscription API. |
| UC-2 BR-4a: Runtime events emitted during command handling still push | `backend_entrypoint_buffers_unscoped_backend_events_emitted_during_command_handling` proves Backend entrypoint posts unscoped BackendEvents after command-scoped events instead of reentrantly posting them during command handling. |
| UC-2 BR-4b: Main keeps pending unscoped events on push channel | `electron_main_defers_unscoped_backend_events_emitted_during_pending_command` proves Main buffers unscoped BackendEvents while a command is pending and flushes them through `tide:backend-event` after command resolution. |
| UC-2 BR-5: Missing Renderer transport is visible | `renderer_entry_surfaces_missing_backend_transport` verifies browser-only previews return a Contract Error instead of silently ignoring Product Shell commands. |

## Implementation Notes

- Keep product transport singular: MessagePort after handshake.
- Use fake Backend process/transport tests before spawning real utilityProcess in integration tests.
- Keep lifecycle messages small and serializable.
- Coalesce high-volume Agent Session updates before Renderer state application.
- Treat Backend restart as recovery, not transparent runtime continuity.
- Do not route provider process APIs through preload or Renderer.
- Keep Backend application services independent from Shared Contracts; the Backend inbound Contract Message Adapter owns DTO mapping.
- Keep Desktop application domains independent from Shared Contracts; the Desktop outbound Backend client owns transport envelope validation.
