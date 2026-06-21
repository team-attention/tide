# Spec: Provider Setup Surface Workbench Command

Status: Superseded by
`docs_v2/specs/thread-workbench-agent-model-cleanup.md`. Active code should use
`open_terminal` with `terminalRole: "provider_readiness"` instead of
`open_provider_setup_surface`.

## Scope

This spec connects Provider Readiness setup actions to a visible Workbench Terminal Pane.

It covers:

- preserving pending Composer input while Provider Readiness is blocked.
- rendering a setup action row from `ProviderSetupSurfaceAction`.
- emitting a `workbench.command` for the selected setup action.
- Backend handling `open_provider_setup_surface`, `focus_pane`, and `close_pane`.
- representing Provider Setup Surface as a visible Terminal Workbench Pane.

It does not implement full terminal rendering. Follow-up specs cover Backend-owned setup process start/stop, bounded transcript preview, terminal-byte input routing, and pending-input replay after setup completion.
The smoke harness may open and close the setup surface to verify the command path, but it must not auto-accept provider-native trust or permission prompts.

## Evidence

- `docs_v2/master-plan.md` says incomplete Provider Readiness preserves Composer input and shows a Provider Setup Surface instead of sending input into a setup screen.
- `docs_v2/specs/provider-integration-bootstrap.md` says Provider Readiness blockers can include `ProviderSetupSurfaceAction` and Desktop shows a Provider Setup Surface action when the Agent Integration can provide one.
- `src/shared/contracts/provider-readiness.ts` already carries `ProviderSetupSurfaceActionDto`.
- `src/backend/adapters/inbound/contract-message-adapter/contract-message-adapter.ts` currently returns `handled: false` for every `workbench.command`.
- `src/desktop/application/domains/agent-chat/agent-chat.ts` currently returns no command for `provider_readiness` choice rows.

## Decisions

### D1. Setup action is a Workbench command

Selecting a Provider Readiness setup action emits `workbench.command` with command `open_provider_setup_surface`.

The command carries the selected setup action in `data.setup`.

### D2. Provider Setup Surface is a Terminal Workbench Pane

Backend represents the setup surface as a visible Terminal Workbench Pane owned by the Thread Workbench.

The pane is not the hidden Agent Runtime conversation. Its metadata records the setup command, args, cwd, and expected completion mode so Desktop can render the surface and the follow-up terminal lifecycle slice can run the setup process.

### D3. Workbench focus and close are real Backend commands

`focus_pane` and `close_pane` mutate Backend Thread Workbench state instead of being Desktop-only placeholders.

Backend emits `workbench.changed` after each handled command.

### D4. Smoke verification may expect setup readiness

Provider smoke can run with an expected Provider Readiness blocker. In that mode it treats `providerReadiness.changed` as the desired outcome, optionally emits `open_provider_setup_surface`, verifies a Terminal Workbench Pane appears, then closes it. This proves the setup path without sending pending Composer input into the provider-native setup process.

## Domain Model

```ts
interface TerminalPaneState {
  paneId: WorkbenchPaneId;
  kind: "terminal";
  title: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  command?: string;
  args?: string[];
  cwd?: string;
  status: "ready" | "running" | "completed" | "failed";
  expectedCompletion?: "process_exit" | "retry_preflight";
  transcriptPreview?: string;
}
```

## Contracts

`WorkbenchPaneRefDto` includes Terminal panes with optional setup metadata:

```ts
interface TerminalPaneRefDto extends BaseWorkbenchPaneRefDto {
  kind: "terminal";
  command?: string;
  args?: string[];
  cwd?: string;
  status: "ready" | "running" | "completed" | "failed";
  expectedCompletion?: "process_exit" | "retry_preflight";
  transcriptPreview?: string;
}
```

`workbench.changed` may include `activePaneId`.

## Flow

### UC-1: Open Provider Setup Surface

1. Backend blocks Thread start because Provider Readiness is incomplete.
2. Desktop keeps the pending Composer draft.
3. Desktop shows the setup row from the blocker setup action.
4. User selects the setup row.
5. Desktop emits `workbench.command` with `open_provider_setup_surface`.
6. Backend creates or reveals a visible Terminal Workbench Pane for that setup command.
7. Backend emits `workbench.changed`.

### UC-2: Focus Workbench Pane

1. User selects a Workbench tab.
2. Desktop emits `workbench.command` with `focus_pane`.
3. Backend marks the pane active and visible.
4. Backend emits `workbench.changed`.

### UC-3: Close Workbench Pane

1. User closes a Workbench tab.
2. Desktop emits `workbench.command` with `close_pane`.
3. Backend marks the pane hidden.
4. Backend emits `workbench.changed`.

## Invariants

1. Provider Setup Surface never writes pending Composer input to the Agent Runtime.
2. Provider Setup Surface is visible Workbench state, not an Agent Session Block.
3. Workbench commands are Thread-scoped.
4. Setup metadata crosses the process boundary without environment variables.
5. Closing a Pane hides it without deleting the Thread.

## Tests

| Rule | Test expectation |
|------|------------------|
| Setup row emits command | `provider_readiness_setup_row_emits_workbench_command_and_preserves_draft` selects the setup row and emits `open_provider_setup_surface`. |
| Backend opens setup pane | `workbench_command_open_provider_setup_surface_creates_terminal_pane` creates a visible Terminal Pane without starting Agent Runtime. |
| Backend focus/close mutate Workbench | `workbench_command_focus_and_close_pane_updates_backend_workbench_state` handles `focus_pane` and `close_pane`. |
| Provider smoke can verify setup Pane path | `provider_smoke_can_expect_provider_not_ready_and_open_setup_surface` proves the opt-in smoke exposes `open_provider_setup_surface` without treating the readiness blocker as failure. |

## Implementation Notes

- Real provider setup PTY process start/stop is covered by [Provider Setup Surface Terminal Lifecycle](provider-setup-surface-terminal-lifecycle.md).
- Keep Desktop and Shared Contracts independent from Backend domain types.
- Keep setup command env out of Shared Contracts.
