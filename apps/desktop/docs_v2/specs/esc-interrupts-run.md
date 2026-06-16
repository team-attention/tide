# Spec: Escape interrupts a running turn

## Scope
While an agent turn is running, pressing Escape interrupts it — the same action as
the composer Stop button — provided no transient UI (which owns Escape) is open.

## Evidence
- The Stop button calls `handlers.onInterrupt` and is shown when
  `chatState === "running"` with an empty draft (composer.tsx).
- Escape is already claimed by: composer chip/command popovers + the image lightbox
  (agent-chat.tsx, only while open); Workbench fullscreen + Settings modal
  (`useEscapeShortcuts`); Quick Open / Content Search / worktree dialogs / inline
  rename (each closes itself on Escape).

## Decisions
- Escape interrupts only when `chatState === "running"` (the working state — matches
  "agent 돌고있을때"). Not `waiting_for_approval`/`waiting_for_input` (a prompt card
  owns those).
- Escape interrupts regardless of draft text (a deliberate panic-stop); the draft is
  preserved (interrupt does not touch it).
- The interrupt listener YIELDS to any open transient UI: it is suppressed when the
  composer surface, Quick Open, Content Search, a worktree dialog, Settings, or
  Workbench fullscreen is open (those handle Escape themselves).

## Out Of Scope
- Changing the Stop/Send button behavior or the queued-steer interrupt rows.

## Flow
- `useEscapeShortcuts` (product-shell altitude — it already centralizes the
  fullscreen/settings Escape and can see every overlay flag) gains an interrupt
  listener that subscribes only while `agentRunning && !interruptSuppressed`, and on
  Escape calls `onInterrupt()` (preventDefault).
- `product-shell.tsx` passes `agentRunning = viewModel.agentChat.chatState ===
  "running"`, `onInterrupt = handlers.onInterrupt`, and `interruptSuppressed` =
  OR of the known overlay flags (quickOpen, contentSearch, worktreeCreate,
  worktreeDelete, composer activeSurface, settings, fullscreen).

## Invariants
- When a transient UI is open, Escape closes that UI and does NOT interrupt.
- The listener is bound only while running, so it never swallows Escape at idle.

## Tests
- Behavior of the gate is covered by the existing Escape effects + a focused unit on
  the suppression predicate if extracted; otherwise verified live (window keydown
  effects are not unit-friendly here). Typecheck + manual run.
