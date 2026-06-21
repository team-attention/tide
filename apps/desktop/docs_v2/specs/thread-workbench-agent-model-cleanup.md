# Spec: Thread Workbench Agent Model Cleanup

## Scope

This spec removes the separate Provider Setup Surface product/model path from
active Tide v2 code.

It covers:

- treating provider install, login, trust, vendor auth, and update handoffs as
  normal Thread-scoped Workbench Terminal Panes.
- keeping the active Agent Runtime as structured provider runtime state, not a
  hidden visible-terminal scrape.
- using Terminal Pane metadata for provider readiness completion behavior.
- preserving pending Composer input while readiness is blocked, then retrying
  preflight after the readiness terminal exits.

It does not change provider-native authentication flows or auto-accept provider
prompts.

## Evidence

- The v2 glossary defines Thread as the user-facing work conversation and
  Workbench as the visible work area attached to a Thread.
- Workbench Terminal Pane Session already defines `open_terminal` as the visible
  terminal path.
- Provider readiness can block before a real Thread turn starts; Composer input
  must not be written into a provider setup/login screen.
- The previous Provider Setup Surface specs created a separate command and
  lifecycle even though the visible UI is just a Terminal Pane.

## Decisions

### D1. No separate setup surface command

Provider readiness handoffs use `workbench.command` `open_terminal`.

### D2. Readiness is terminal metadata

Provider readiness Terminal Panes carry:

- `terminalRole: "provider_readiness"`
- `expectedCompletion: "retry_preflight"` or `"process_exit"`

### D3. Readiness actions are terminal actions

Provider Readiness contracts expose `terminalAction`, not `setup`.

### D4. Active Agent Runtime is not a visible PTY pane

The active coding Agent Runtime remains Backend-owned structured runtime state.
PTY-backed visible surfaces are Workbench Terminal Panes only.

## Out Of Scope

- Reworking provider runtime transports.
- Changing provider credentials, trust storage, or OAuth flows.
- Replacing the existing Terminal Pane renderer.

## Domain Model

- Thread owns one Workbench.
- Workbench owns visible Panes.
- Terminal Pane can be a shell session, command result, or provider readiness
  handoff.
- Provider Readiness describes blockers and optional terminal actions.

## Contracts

- `ProviderReadinessBlockerDto.terminalAction?: ProviderReadinessTerminalActionDto`
- `ProviderUpdateAdvisoryDto.terminalAction`
- `TerminalPaneRefDto.terminalRole?: "session" | "command_result" | "provider_readiness"`
- `open_terminal` command data may include command, args, env, cwd,
  `terminalRole`, and `expectedCompletion`.

## Flow

1. Backend reports Provider Readiness blockers with optional terminal actions.
2. Desktop renders a readiness action row.
3. Selecting the row sends `workbench.command` `open_terminal` with readiness
   terminal metadata.
4. Backend opens and starts a normal Workbench Terminal Pane.
5. Terminal input writes to that pane's terminal handle.
6. On process exit, Backend records terminal completion.
7. If the pane is `provider_readiness` and expects `retry_preflight`, Backend
   refreshes update advisories, re-runs Provider Readiness, and either replays
   pending input or emits the remaining blocker.

## Invariants

- `open_provider_setup_surface` is not an active command.
- Provider readiness handoffs do not create Agent Runtime sessions.
- Pending Composer input is preserved until Provider Readiness succeeds.
- Visible terminal PTYs are Workbench Terminal Pane handles.
- Agent Runtime state does not render as a Terminal Pane.

## Tests

- Backend `open_terminal` creates and starts provider readiness Terminal Panes.
- Terminal input routes to the visible Workbench Terminal handle.
- Readiness terminal exit retries preflight and replays pending input when ready.
- Blocked retry preserves pending input and emits readiness.
- Desktop readiness rows dispatch `open_terminal` with provider readiness
  metadata.
- Shared contracts round-trip provider readiness terminal action fields and
  Terminal Pane metadata.

## Implementation Notes

- Historical Provider Setup Surface specs remain as superseded references.
- New work should use Workbench Terminal Pane lifecycle, not a parallel setup
  surface lifecycle.
