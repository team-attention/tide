# Spec: Provider Setup Surface Terminal Lifecycle

Status: Superseded by
`docs_v2/specs/thread-workbench-agent-model-cleanup.md`. Active code should use
the normal Workbench Terminal Pane lifecycle with provider-readiness metadata.

## Scope

This spec turns the Provider Setup Surface Terminal Pane from metadata-only Workbench state into a Backend-owned visible setup process.

It covers:

- launching the setup command in a PTY-backed Provider Setup Surface.
- moving the Terminal Pane from `ready` to `running`.
- preserving pending Composer input while setup is running.
- appending bounded setup output into `transcriptPreview`.
- stopping the setup process when the Pane is closed.

It does not implement a full terminal renderer or automatic provider-specific setup answers. Follow-up input routing and pending-input replay are covered by [Provider Setup Surface Input And Retry](provider-setup-surface-input-and-retry.md).

## Evidence

- `docs_v2/master-plan.md` says incomplete Provider Readiness preserves Composer input and shows a Provider Setup Surface instead of sending input into provider setup screens.
- `docs_v2/master-plan.md` says Provider Setup Surface runs the provider's own setup flow in a visible terminal surface.
- `docs_v2/specs/provider-setup-surface-workbench-command.md` created Thread-scoped Terminal Workbench Pane metadata and explicitly deferred provider setup process lifecycle.
- `src/backend/application/services/thread-runtime-service.ts` creates `TerminalPaneState` with status `ready` when handling `open_provider_setup_surface`.
- `src/backend/adapters/outbound/pty/python-pty-process-launcher.ts` already provides a PTY-backed process launcher used by Agent Runtime wiring.

## Decisions

### D1. Provider Setup Surface process is not Agent Runtime

Provider Setup Surface uses the same PTY launcher capability as Agent Runtime, but it is not the Thread's hidden Agent Runtime and never receives pending Composer input.

### D2. Backend owns setup Pane lifecycle

Backend starts the setup process when `open_provider_setup_surface` creates or reveals a setup Terminal Pane. The resulting `workbench.changed` event shows the Pane as `running`.

### D3. Setup output is bounded preview

Until full terminal rendering exists, setup output is stored as a bounded `transcriptPreview` on the Terminal Pane. This gives Desktop visible evidence that the setup flow is actually running without turning Agent Chat into a terminal.

### D4. Closing setup Pane stops setup process

Closing a running Provider Setup Surface Pane stops its setup process. Hidden setup processes must not keep running after the user closes their visible setup surface.

## Domain Model

Provider Setup Surface port:

```ts
interface ProviderSetupSurfaceTerminalPort {
  start(input: ProviderSetupSurfaceStartInput): Promise<ProviderSetupSurfaceHandle>;
}

interface ProviderSetupSurfaceStartInput {
  threadId: ThreadId;
  paneId: WorkbenchPaneId;
  command: string;
  args: string[];
  cwd: string;
  onOutput?: (output: ProviderSetupSurfaceOutput) => void;
}
```

Terminal Pane state keeps its existing contract fields:

```ts
status: "ready" | "running" | "completed" | "failed";
transcriptPreview?: string;
```

## Flow

### UC-1: Launch Provider Setup Surface

1. Thread is blocked by Provider Readiness and has pending Composer input.
2. User selects the setup row.
3. Desktop emits `workbench.command` with `open_provider_setup_surface`.
4. Backend creates or reveals the Terminal Pane.
5. Backend starts the setup command through `ProviderSetupSurfaceTerminalPort`.
6. Backend marks the Pane `running`.
7. Backend emits `workbench.changed`.

### UC-2: Setup output preview

1. Setup process writes PTY output.
2. Backend appends the text to the Terminal Pane `transcriptPreview`.
3. Backend bounds the preview to recent output.
4. Pending Composer input remains unchanged.

### UC-3: Close running setup Pane

1. User closes the Provider Setup Surface Pane.
2. Backend stops the setup process handle.
3. Backend hides the Pane and emits `workbench.changed`.

## Invariants

1. Provider Setup Surface never writes pending Composer input.
2. Provider Setup Surface process is separate from Agent Runtime process.
3. Setup output preview is bounded.
4. Closing a running setup Pane stops the setup process.
5. The setup Pane remains Thread-scoped Workbench state.

## Tests

| Rule | Test expectation |
|------|------------------|
| Setup process launches | `workbench_command_open_provider_setup_surface_starts_setup_terminal_process` proves the setup command starts, Pane status becomes `running`, and pending input is preserved. |
| Setup output is bounded preview | `provider_setup_surface_output_updates_terminal_pane_preview` proves PTY output appends to the Terminal Pane preview. |
| Closing stops setup | `closing_running_provider_setup_surface_stops_setup_process` proves close hides the Pane and stops the setup handle. |
| Live backend wires setup PTY | `live_backend_uses_pty_port_for_provider_setup_surface` proves live wiring supplies a PTY-backed Provider Setup Surface port. |

## Implementation Notes

- Keep the port in Backend application/outbound boundary.
- Reuse the existing Python PTY launcher in the outbound adapter.
- Do not add setup terminal input UI in this slice.
- Do not auto-replay pending Composer input until a separate readiness-retry spec defines that behavior.
