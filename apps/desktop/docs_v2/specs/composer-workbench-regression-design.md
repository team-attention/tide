# Spec: Composer Workbench Regression Design

## Scope

Document the regressions raised in the Composer + Workbench session, the target
model, and the implementation decisions that fix them.

In scope:

- Composer screen Workbench Browser action does not open a Browser Pane.
- Terminal open/close feels inconsistent.
- Chat/session links briefly expose the generic Launcher instead of opening a
  new Browser Pane directly.
- Runtime usage updates appear as visible transcript cards.
- Selecting a later queued composer input and pressing "send now" still runs the
  queue in FIFO order.

Out of scope:

- Replacing Browser `<webview>` or Terminal PTY infrastructure.
- Changing hidden Agent Runtime transport.

Implementation status:

- The fixes are implemented in the Product Shell state layer, backend command
  adapter/runtime services, structured runtime reducer/projector, and focused
  regression tests.

## Mental Model

The product model should be simple:

1. Every visible work surface is a Workbench Pane owned by a Thread.
2. The Composer screen uses a real Draft Thread once the user opens real work.
3. Open/close UX is pane-generic.
4. Pane-specific resources are backend implementation details.

The complexity exists because the visible panes are not all the same resource:

| Pane | Visible UX | Resource that must be owned/cleaned up |
|---|---|---|
| Launcher | Action placeholder | Usually only Workbench state; on the first Composer screen it is renderer-only until a Draft Thread exists. |
| Browser | Browser surface | Browser pane snapshot, WebView/session state, optional agent/browser-control state. |
| Terminal | Terminal surface | PTY process/handle plus output stream. Closing must stop the PTY. |
| Editor | File buffer | File path, loaded content, dirty draft, save/navigation state. No long-running process. |
| Diff/Changes | Comparison view | Diff source/snapshot; no long-running process. |

This does not mean the user-facing behavior should be complex. It means the
Workbench command layer must hide resource differences behind one pane lifecycle:

- open pane;
- focus pane;
- close pane;
- if a pane owns an external resource, dispose it in the backend.

## Evidence

- `composer-draft-thread.md` says the Composer screen becomes a real Draft
  Thread on first real Workbench action. Browser, Editor, Terminal, and Diff must
  then use the normal per-thread `workbench.command` path.
- `workbench-dock-parity.md` says the Launcher is a placeholder resolved into the
  selected pane. It is not supposed to remain as an unrelated intermediate surface.
- `workbench-launcher-terminal-usability.md` already records three related
  regressions: Launcher actions leaving Launcher visible, Draft Thread startup
  closing the Workbench, and Terminal readiness lag.
- `usage-remaining-popover.md` places session context near the Composer and
  provider/account quota in Settings. It does not define a visible transcript
  `Usage updated` card.
- `backend-authoritative-composer-queue.md` makes the backend queue authoritative,
  but it does not define a command for promoting a selected queued input.
- Live smoke after the initial synthetic-launcher reducer fix still showed
  Browser not opening: Browser pane absent and the Workbench still on Launcher.
  Backend unit tests for browser command creation passed, so the remaining gap is
  likely renderer command dispatch / live bridge / Browser-specific handling, not
  the backend domain concept alone.

## Decisions

### D1. Composer Launcher Is Only Synthetic Before The First Real Action

The first Composer Workbench screen can render a synthetic Launcher because no
Draft Thread exists yet. That synthetic pane id is never a backend pane id.

When the user selects Browser, Terminal, Editor, or Diff:

1. Desktop creates the Draft Thread.
2. Desktop makes the Draft Thread the active Workbench context.
3. Desktop sends the normal `workbench.command` against that draft thread.
4. Desktop must not send the synthetic Composer launcher id as `targetPaneId`.

### D2. Browser And Terminal Should Follow The Same Product Lifecycle

Browser and Terminal differ only in backend resource cleanup:

- Browser close releases Browser pane/control state.
- Terminal close stops the visible PTY.

The UI lifecycle should not fork:

- open from Launcher or direct command;
- focus the created pane;
- close the selected pane;
- when the last real pane is closed, close the Workbench column. Showing an
  empty Launcher is only for explicit "open Workbench/New Pane" actions, not for
  pane close.

### D3. Direct Browser Opens Must Not Show Generic Launcher As An Intermediate

Opening a chat/session transcript link is a new Browser Pane intent, not a
Launcher intent and not "navigate the active Browser". Browser-internal
navigation stays inside that Browser Pane; transcript/session links create a new
Browser Pane so the current Browser context is not overwritten.

The Workbench should either:

- keep the current visible surface until the Browser snapshot arrives; or
- show a Browser-specific pending pane.

It must not flash the generic Launcher unless the user explicitly opened a new
Launcher pane.

### D4. Usage Updates Are Runtime State, Not Transcript Content

Usage updates must continue to update state for the Composer context meter and
Settings provider quota rows. They should not appear as visible Agent Session
cards in the transcript.

### D5. "Send Now" On A Queued Row Must Address That Row

The queue is backend-authoritative and head-first, but the UI affordance is row
specific. Pressing "send now" on row N must send N to the backend.

The backend needs an explicit command, for example:

```ts
composer.runQueuedInputNow({ threadId, index })
```

Semantics:

- `index = 0`: same as current interrupt/send-next behavior.
- `index > 0`: promote that queued input to the head, preserve the relative order
  of the other queued inputs behind it, then interrupt/settle the active runtime
  so the promoted input runs next.

## Flows

### Composer Launcher To Browser

1. User opens Workbench on the Composer screen.
2. Renderer shows the synthetic Composer Launcher.
3. User clicks Browser.
4. Desktop creates Draft Thread if needed.
5. Desktop sends `workbench.command open_browser` with `threadId = draftThreadId`
   and no synthetic `targetPaneId`.
6. Backend creates a real Browser Pane in the Draft Thread Workbench.
7. Desktop renders that Browser Pane. The Launcher is gone unless the user opens
   another Launcher explicitly.

### Link To Browser

1. User clicks a link in transcript/session content.
2. Desktop records a new-Browser pending intent or keeps current pane visible.
3. Desktop sends `workbench.command open_browser` with URL and
   `disposition: "new_browser_pane"`.
4. Backend creates a new Browser Pane.
5. Desktop renders Browser directly. The Launcher is never the visible
   intermediate for this action.

### Close Terminal

1. User closes a Terminal Pane.
2. Desktop sends `workbench.command close_pane` for that pane id.
3. Backend stops the PTY and removes/hides the pane from the Thread Workbench.
4. Desktop receives `workbench.changed`.
5. If no real panes remain, Desktop closes the Workbench column. Reopening the
   Workbench later shows the Launcher as an explicit empty-Workbench affordance.

### Usage Update

1. Runtime reports usage.
2. Backend emits state events used by Composer/Settings.
3. Renderer updates context meter and provider quota rows.
4. Renderer does not add a visible transcript usage card.

### Selected Queue Steering

1. User queues several composer inputs while a turn is running.
2. User presses "send now" on row N.
3. Desktop sends row index N to the backend.
4. Backend promotes row N to the head and preserves the other rows.
5. Backend interrupts/settles the active runtime so the promoted input runs next.
6. Backend emits `agentRuntime.queueChanged`; Desktop reconciles to the backend
   queue.

## Invariants

- Synthetic pane ids are never sent as backend `targetPaneId` values.
- A real Workbench Pane always belongs to a real Thread or Draft Thread.
- Composer chat mode is not the same thing as `activeThreadId === null`; once the
  Draft Thread exists, Composer chat can still render the start composer while the
  Workbench uses the draft thread as its active context.
- Browser/Terminal/Editor/Diff open paths should converge on
  `workbench.command`; only resource creation/disposal differs behind the command.
- Direct Browser opens must not route through or visually flash the Launcher.
- Transcript/session links always open a new Browser Pane; Browser-internal
  navigation stays within the Browser Pane where it occurred.
- Closing the last real pane closes the Workbench column.
- Usage state must not create visible transcript noise.
- Queue row actions must include the selected row identity/index.

## Tests

### Workbench / Browser

- Renderer integration: clicking Browser on the Composer synthetic Launcher first
  emits `thread.createDraft`, then emits `workbench.command open_browser` against
  the draft thread without `targetPaneId`.
- Renderer integration: clicking Browser on a real backend Launcher includes that
  real launcher `targetPaneId` so backend can resolve the placeholder in-slot.
- Electron smoke: Browser click from Workbench Launcher must result in a visible
  Browser Pane. The smoke should fail if the Workbench remains on Launcher.
- Link open test: transcript/session link opens a new Browser Pane and does not
  render the generic Launcher as the pending surface.

### Terminal

- Backend: `close_pane` on Terminal stops the PTY and removes/hides the pane.
- Renderer: closing the last Terminal closes the Workbench column, not a stale
  Terminal, duplicate Launcher, or empty Launcher fallback.
- Electron smoke: open Terminal, type, close Terminal, reopen Terminal.

### Usage

- Runtime usage event updates Composer context meter.
- Runtime usage event does not render a transcript `Usage updated` card.
- Settings provider quota rows still update from provider usage snapshots.

### Queue

- Backend: `runQueuedInputNow({ index: 2 })` promotes the third queued input to
  head and preserves all input metadata.
- Backend: `index = 0` behaves like current send-now/interrupt path.
- Renderer: row-level "send now" passes the row index.
- Renderer/backend: after promotion, `agentRuntime.queueChanged` matches the
  backend order.

## Implementation Notes

- Do not create a second Composer-only Workbench model. The Composer Draft Thread
  is the real owner for real panes.
- Do not solve Browser by making Launcher persistent. Launcher is a placeholder or
  empty-state affordance, not a routing surface for every direct open.
- Keep Terminal-specific PTY cleanup in backend Workbench services.
- Prefer an explicit pending Browser intent over generic Workbench-open fallback.
- Existing tests that expect visible transcript usage blocks should be updated to
  assert state update without transcript rendering.

## Open Questions

- None for link-open and last-pane-close behavior. Chat/session transcript links
  open new Browser Panes. Closing the last real pane closes the Workbench column.
