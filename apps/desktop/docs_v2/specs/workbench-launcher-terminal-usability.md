# Spec: Workbench Launcher And Terminal Usability

## Scope

Fix the Workbench regressions where Launcher actions leave the Launcher visible over the opened pane, Composer Draft Thread Workbench actions close the Workbench during startup, and visible Terminal Panes accept input only after a delayed running-state update.

## Evidence

- `master-plan.md` defines Workbench as the optional visible work area inside a Thread. Browser and Terminal Panes are visible Workbench Panes, not hidden Agent Runtime surfaces.
- `glossary.md` defines Launcher as a Workbench Pane action entry point and Terminal Pane as a visible Workbench Pane.
- `workbench-launcher-pane.md` and existing code model the Launcher as a placeholder that is resolved into Browser, Editor, Terminal, Diff, or Changes.
- `workbench-terminal-pane-session.md` and current backend code use a PTY-backed visible Terminal Pane and stream output through `workbench.terminalOutput`.

## Decisions

- A Launcher action consumes the Launcher pane where the action was clicked. It must not depend on the active pane being the launcher.
- The Composer's synthetic Launcher creates a Draft Thread before opening a real pane. The first empty `workbench.changed` for that Draft Thread must preserve the already-open Workbench while the real pane command is in flight.
- A visible Terminal Pane becomes input-eligible as soon as its PTY handle starts. Desktop must receive that `running` state promptly.
- Terminal keystrokes should be routed as transport commands without forcing a React state update per key.

## Out Of Scope

- Replacing the Python PTY bridge.
- Changing hidden Agent Runtime transport.
- Adding new Workbench Pane kinds.
- Reworking split layout persistence.

## Domain Model

- Launcher Pane: placeholder pane with actions.
- Composer Draft Thread: backend Thread created before the first Composer send so Workbench Panes can exist pre-send.
- Terminal Pane: visible PTY-backed pane with `ready`, `running`, `completed`, or `failed` status.

## Contracts

- `workbench.command.targetPaneId` may identify the Launcher Pane being resolved.
- Existing `workbench.changed` and `workbench.terminalOutput` events remain the Desktop update path.

## Flow

1. User opens Launcher in an existing Thread.
2. User clicks Browser, Terminal, Editor, or Diff.
3. Desktop sends `workbench.command` with the clicked launcher `targetPaneId` when one exists for Browser, Terminal, and Diff actions.
4. Backend opens the selected pane, activates it, and removes the target Launcher.
5. Desktop receives a `workbench.changed` snapshot without the consumed Launcher.

Composer Draft flow:

1. User opens the Workbench from Start Composer.
2. User clicks Browser in the synthetic Launcher.
3. Desktop creates the Draft Thread, keeps Workbench open, then sends `open_browser`.
4. An empty Draft Thread `workbench.changed` does not close the Workbench.
5. The Browser Pane snapshot replaces the launcher view.

Terminal flow:

1. User opens Terminal.
2. Backend creates the pane, starts PTY asynchronously, and emits a `workbench.changed` when status becomes `running`.
3. xterm input routes directly to the backend command path without per-key state churn.

## Invariants

- A real Browser Pane opened from a Launcher must be visible immediately without requiring the user to close the Launcher.
- Reopening the Composer Workbench after a Browser action must not show both Browser and Launcher because of an intermediate empty Draft Thread snapshot.
- The Terminal Pane input path must not reject normal typing merely because the initial `open_terminal` response was returned before PTY startup completed.

## Tests

- Backend: opening Browser with a non-active launcher `targetPaneId` removes that launcher and activates Browser.
- Desktop state: launcher Browser action includes `targetPaneId` when it came from a real launcher.
- Desktop state: the first empty `workbench.changed` for an open Composer Draft Thread keeps Workbench open.
- Backend: opening a session Terminal emits an async `workbench_changed` once the PTY handle is retained and status is `running`.
- Desktop state: terminal input command generation does not require mutating shell state.

## Implementation Notes

- Prefer the existing `targetPaneId` field on `workbench.command`; no shared contract expansion is required.
- Editor's picker currently opens through a separate delayed file-selection command. Preserve its existing active-launcher behavior in this slice.
- Do not emit a backend launcher for the Composer's synthetic launcher.
- Keep output streaming on `workbench.terminalOutput`; the additional running-state snapshot is only for pane status and input eligibility.
