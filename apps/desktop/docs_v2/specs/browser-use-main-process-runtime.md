# Spec: Browser Use Main-Process Runtime

## Scope

Move Tide Browser Use from a renderer-lifecycle action model to a durable
main-process browser runtime.

The goal is first-class in-app browser control:

- The agent can observe and act on the page whether the Workbench pane is
  foregrounded, backgrounded, hidden by a thread switch, or hidden because the
  Workbench is closed.
- When the user opens the Workbench pane, they see and can operate the same live
  browser page the agent has been using.
- Browser panes remain thread-bound Workbench panes. A browser runtime belongs to
  a specific `{ threadId, paneId }`; it is not a global browser surface that can
  leak between threads.
- The Tide MCP tool surface keeps resolving calls to the caller's Thread. The
  browser runtime changes how tools execute, not which Thread they are allowed to
  target.

This spec supersedes and removes the old Browser Pane action execution path where the
Backend stores `pendingAction` in Workbench state and a React-rendered
`<webview>` effect performs the action.

## Out Of Scope

- Driving the user's external Chrome or the OS desktop.
- Depending on private Electron/internal APIs such as webview adoption leases.
- Native file chooser automation, native permission prompts, downloads, and
  system dialogs beyond preserving existing popup behavior.
- Changing the Workbench model so panes are no longer bound to Threads.

## Removed Tide Model

The removed Browser Use model split execution across Backend, Renderer, and
Workbench state:

- `tide_open_browser` mutates the caller Thread's Workbench pane list.
- `tide_observe_browser(mode=screenshot|both)` sets `pendingCapture` on the
  pane, emits `workbench_changed`, waits for a renderer `<webview>` to
  `capturePage`, and falls back on timeout.
- `tide_act_browser` validates the caller Thread and pane revision, then writes
  `pendingAction` into the Browser Pane state.
- `WorkbenchBrowserPane` or `BackgroundBrowserHost` sees `pendingAction`,
  executes it through `webview.sendInputEvent` or `webview.executeJavaScript`,
  and reports `update_browser_action_result`.
- `deriveBackgroundBrowserPanes` keeps offscreen `<webview>`s mounted only when
  the pane is visible/active-thread warm or leased by pending agent work.

This made the first implementation possible, but the execution authority is the
renderer `<webview>` lifecycle. If no suitable host is mounted, if the host is
not ready, or if a renderer effect misses the state transition, the action stays
pending or times out. The MCP call itself is fast; the slow part is waiting for a
renderer-hosted side effect to notice and answer.

## Reference Architecture Findings

The useful reference architecture is an ownership split, not a private API:

- A durable browser backend owns tab/runtime execution.
- Visible and hidden hosts only present or keep alive the page surface.
- Input can be modeled as CDP-shaped commands such as
  `Input.dispatchMouseEvent`, `Input.dispatchKeyEvent`,
  `Page.captureScreenshot`, `Runtime.evaluate`,
  `Emulation.setFocusEmulationEnabled`, and `Target.setAutoAttach`.
- In-app browser input may need a translated JavaScript path for supported
  `Input.*` commands so focus does not depend on the native window state.
- Private webview adoption primitives are implementation details and should not
  be required by Tide.

The architectural lesson is the ownership split: a durable browser backend owns
execution, while the visible or hidden hosts present the page.

## Decisions

### D1. BrowserRuntime is the execution authority

Browser actions and observations execute in a durable BrowserRuntime, not in a
React effect. The Workbench pane is a projection of that runtime.

`pendingAction` and `pendingCapture` are not execution mechanisms and are not
Browser Pane contract fields. Runtime requests do not require Workbench state
changes to perform an action or capture pixels.

### D2. Runtime identity is thread-bound

The runtime key is:

```ts
interface BrowserSessionKey {
  threadId: string;
  paneId: string;
}
```

The key may gain an opaque `runtimeId` for crash recovery and close/reopen
disambiguation, but it must never lose `threadId` and `paneId`.

The visible Workbench pane stays in the Thread snapshot. Switching Threads only
changes which projection is visible; it does not migrate browser ownership.

### D3. Tide MCP remains Thread-scoped

`TideMcpToolHandler.resolveMcpThread` remains the authority for which Thread a
tool call may touch. `tide_observe_browser` and `tide_act_browser` resolve
`paneId` inside that Thread, then call BrowserRuntime through a port.

An agent in Thread A cannot act on a Browser Pane in Thread B even if both panes
share cookies or storage partition.

### D4. Electron main implements the browser runtime adapter

The Backend runs in an Electron utility process and cannot own Electron
`WebContents`. The Backend application should depend on a `BrowserRuntimePort`.
The Desktop/Electron main side implements that port because it can create and
control `WebContents`, attach the debugger, and host native views.

Process direction:

```text
Tide MCP call
  -> Backend TideMcpToolHandler
  -> Backend BrowserRuntimePort
  -> Shared contract / utility-process bridge
  -> Electron main BrowserRuntimeHost
  -> WebContents / debugger / CDP
```

Renderer React is no longer in the execution path for agent actions.

### D5. Workbench state is declarative

Workbench Browser Pane state remains backend-authoritative evidence:

- URL/title/loading/readiness.
- Last action result.
- Last screenshot or text observation.
- Agent-driving and user-control status.

It does not act as a command queue. `workbench.changed` keeps the UI in sync, but
action execution is a direct request/response with BrowserRuntime.

### D6. There is still a per-tab serial executor

We still need serialization, but not a renderer Workbench queue.

Mouse, keyboard, navigation, capture-surface resize, and post-action observation
must not interleave on the same tab. BrowserRuntime owns a per-tab serial
executor that preserves event order and returns terminal results. This is an
internal runtime mutex, not `pendingAction` in Thread state.

### D7. Waits are bounded evidence waits

The target design still waits in three places:

- Runtime creation/navigation readiness.
- Post-action settle so the tool can return current URL/title/readiness and, when
  requested, fresh pixels.
- Capture-surface or viewport readiness before `Page.captureScreenshot`.

These waits are bounded and tied to browser signals or layout checks. They do
not wait for React to mount a pane or for a Workbench state echo.

### D8. Presentation should use public Electron primitives

Target presentation should be implemented with main-owned `WebContents` and a
native presentation host such as `WebContentsView`.

Important consequences:

- The page is not a React DOM child. React renders an address bar, tab chrome,
  and a placeholder/stage; Electron main attaches the native child view to the
  BrowserWindow and updates its bounds from renderer measurements.
- DOM overlays cannot be assumed to layer above the browser view. Agent cursor,
  lock veil, selection toolbar, and hit-test affordances need a deliberate
  layering plan: either native overlay views/windows or a tested z-order strategy.
- The same `WebContents` can be detached from one presentation and attached to
  another, but Tide must manage ownership so a page is presented in at most one
  host at a time.

The Browser Pane presentation is native-runtime only. A renderer `<webview>` is
not a Browser Use presentation, execution, or hidden-capture mechanism.

### D9. Agent control and user control are explicit leases

BrowserRuntime tracks control state per runtime:

- `idle`: user and agent are not currently contending.
- `agent`: an agent action sequence is in progress.
- `user`: the visible user took control; agent drive attempts are refused until
  the next agent turn or an explicit release policy resets the gate.

Visible user input acts on the same `WebContents`. If the user clicks "Take
control", BrowserRuntime cancels queued agent input for that pane and the
Workbench state records user control.

### D10. Storage identity is separate from pane ownership

BrowserRuntime uses the shared `persist:tide-workbench-browser` storage
partition, so browser storage is shared across panes. That is the first product
policy.

Runtime ownership is still `{ threadId, paneId }`. Shared cookies do not imply
shared tab identity or cross-thread MCP access.

### D11. Hidden screenshot freshness uses a managed capture surface

Do not depend on a fully detached `WebContents` to paint fresh pixels. The
BrowserRuntime owns a managed hidden capture surface for cases where the
Workbench pane is not visibly attached.

The production shape is:

1. Set the requested capture surface size for the runtime.
2. Attach or keep the page in a hidden but paintable surface.
3. Wait for layout evidence such as viewport/layout metrics to match the
   requested capture size.
4. Run `Page.captureScreenshot`.
5. Clear or shrink the capture surface after the operation.

This is the correctness mechanism for hidden observation and background action.

The first implementation is covered by `npm run test:browser-runtime`, which
drives the built Electron app and verifies:

- A Browser Pane opened through the Workbench command path is backed by a
  `WebContentsView` attached to the main window.
- `observe(mode=both)` returns current pixels while the pane is visible.
- After the runtime is detached from the visible pane and navigated, a hidden
  `observe(mode=both)` returns fresh pixels from the new page rather than stale
  visible-frame pixels.
- A hidden click action returns a terminal result and updates page state.

Renderer screenshot APIs do not reliably include Electron native child views,
so the automated visible-presentation proof is structural attachment plus
runtime pixels. Human-visible compositor verification can be added later with an
OS-level screen-capture harness if needed.

### D12. Native overlay is a separate child view

Agent cursor and lock UI cannot depend on React DOM z-index because the browser
page is a native child view, not a DOM child. The first runtime implementation
uses a second transparent `WebContentsView` as the native overlay:

- The browser page `WebContentsView` is attached to the `BrowserWindow`
  `contentView`.
- When `agentDriving` is true for the visible Browser Pane, BrowserRuntime
  attaches an overlay `WebContentsView` with the same bounds after the browser
  view. Electron's `View.addChildView` reorders an already-added child to the
  top, so re-adding the overlay is the z-order mechanism.
- The overlay renders the lock veil, cursor, and Take control button in a
  self-contained transparent document.
- The Take control button navigates to a private runtime URL. Electron main
  intercepts that navigation and sends a renderer IPC event; the mounted Browser
  Pane calls the existing release-control Workbench command.
- When the pane is hidden, detached, or no longer agent-driven, the overlay view
  is removed.

`npm run test:browser-runtime` verifies that the overlay is attached to the
same main window and bounds as the browser view, and that Take control emits a
renderer release event for the current `{ threadId, paneId }`.

### D13. Initial retention policy is deliberately simple

Runtime retention starts with product lifecycle, not a complex cache:

- Close the runtime when the Browser Pane is closed.
- Close the runtime when the Thread is archived, deleted, or otherwise removed
  from the live rail.
- Close all runtimes on app quit.
- Keep the runtime alive while an agent turn is active.
- Keep the runtime alive while its Thread is active or recent enough that the
  user may reasonably reopen the pane.

The first implementation does not add an idle TTL. Active/recent Thread runtimes
stay alive while the app process is alive and the Browser Pane/Thread still
exists. A later TTL is a product cache policy, not a BrowserRuntime correctness
requirement.

## Target Components

### Backend

`TideMcpToolHandler`

- Resolves the MCP session to a Thread.
- Resolves and validates the Browser Pane.
- Performs revision/CAS checks.
- Calls `BrowserRuntimePort` for open, observe, act, and close.
- Updates Thread Workbench evidence from the runtime result.
- Emits `workbench_changed` after evidence changes.

`BrowserRuntimePort`

```ts
interface BrowserRuntimePort {
  ensure(input: BrowserEnsureRequest): Promise<BrowserEnsureResult>;
  navigate(input: BrowserNavigateRequest): Promise<BrowserObservation>;
  observe(input: BrowserObserveRequest): Promise<BrowserObservation>;
  act(input: BrowserActRequest): Promise<BrowserActionResult>;
  close(input: BrowserCloseRequest): Promise<void>;
}
```

This is a Backend outbound port. Its implementation lives across the shared
process boundary in Electron main.

### Electron main

`BrowserRuntimeHost`

- Owns `Map<BrowserSessionKey, BrowserTabRuntime>`.
- Creates and destroys `WebContents`.
- Attaches `webContents.debugger` and manages CDP sessions.
- Maintains per-tab serial executors.
- Executes navigation, observation, input, screenshot, popup, and lifecycle
  operations.
- Emits browser-runtime events that the Backend maps into Workbench evidence.

`BrowserCdpExecutor`

- Attaches/detaches debugger.
- Sends CDP commands with timeouts.
- Keeps the API shape compatible with future OOPIF/frame target routing through
  `Target.setAutoAttach`.
- Enables focus emulation where appropriate.
- Normalizes CDP errors into structured Tide errors.

`BrowserInputTranslator`

- Converts Tide actions to CDP-shaped input.
- For same-origin/main-frame in-app input, may translate supported `Input.*`
  commands to page JavaScript so focus does not depend on OS window focus.
- Uses browser-level coordinate input for page coordinates.
- Cross-origin iframe selector targeting is a hardening item: until the target
  CDP session is identified, it must fail structurally rather than hanging or
  clicking a guessed target.

`BrowserPresentationHost`

- Attaches a runtime's `WebContents` to a visible Workbench stage.
- Detaches when the pane is hidden, closed, or moved.
- Updates native view bounds from renderer measurements.
- Keeps address bar and Workbench chrome in React.

### Renderer

Renderer responsibilities become UI-only:

- Render thread-bound Workbench panes and browser chrome.
- Report browser stage bounds/visibility to Electron main.
- Render overlay/lock state derived from Workbench state.
- Forward user toolbar commands such as address-bar navigation, reload, back,
  forward, open external, and take-control to Backend/runtime commands.

Renderer no longer executes agent browser actions or capture requests.

## Runtime Lifecycle

### Open or reuse Browser Pane

1. MCP calls `tide_open_browser`.
2. Backend resolves the caller Thread.
3. Backend creates or reuses a Browser Pane in that Thread.
4. Backend calls `BrowserRuntimePort.ensure({ threadId, paneId, url })`.
5. Electron main creates or reuses the runtime and navigates if needed.
6. Backend stores returned observation evidence and emits `workbench_changed`.
7. If the Workbench pane is visible, Renderer presents the runtime by key.

Opening a browser does not require the Workbench to be open.

### Thread switch

1. Product Shell switches active Thread.
2. Renderer detaches browser presentation for the old visible pane.
3. Renderer attaches presentation for the new visible pane if the Workbench is open
   and the active pane is a Browser Pane.
4. Browser runtimes for both Threads remain alive until their pane/thread
   lifecycle says otherwise.

No action or observation depends on the active Thread in the UI.

### Workbench close

Closing the Workbench hides projections. It does not close BrowserRuntime for
still-open Browser Pane records.

Closing the Browser Pane itself, deleting the Thread, or disposing the agent
session closes the runtime unless a future persistence policy explicitly retains
it.

### App background or other window focused

Agent actions must avoid Electron `sendInputEvent` as the primary path because
it is tied to native focus behavior. BrowserRuntime should prefer debugger/CDP
and JavaScript-translated input. Background operation is an acceptance criterion.

## Action Flow

`tide_act_browser` target behavior:

1. Resolve MCP session to Thread.
2. Resolve `{ threadId, paneId }`.
3. Check revision unless the action explicitly opts into latest-known state.
4. Check user-control gate.
5. Call `BrowserRuntimePort.act`.
6. BrowserRuntime serializes the action on that runtime.
7. Runtime performs input/navigation and bounded post-action settle.
8. Runtime returns a terminal `completed` or `failed` result plus observation
   evidence.
9. Backend updates Workbench pane evidence, mints a new revision when page
   evidence changed, emits `workbench_changed`, and returns the terminal result
   to MCP.

The target `tide_act_browser` should normally return a terminal result, not
`status: "pending"`. Long-running navigation may still return a structured
timeout/failure, but it should not leave an unresolved Workbench action.

## Observation Flow

`tide_observe_browser` target behavior:

1. Resolve MCP session and Browser Pane.
2. Check revision when supplied.
3. Call `BrowserRuntimePort.observe`.
4. Runtime reads DOM/text/interactive elements through CDP or isolated-world
   JavaScript.
5. If `mode` includes pixels, Runtime captures a screenshot through CDP capture
   or a managed capture surface.
6. Backend stores the observation and returns it.

Observation no longer emits a `pendingCapture` workbench change and waits for a
renderer host to capture.

## Input Strategy

Tide actions map to runtime commands:

| Tide action | Runtime strategy |
| --- | --- |
| `move_to` | Cursor state update for overlay plus optional `Input.dispatchMouseEvent(mouseMoved)` |
| `click_at` | Pointer move/down/up sequence, translated JS path first when appropriate |
| `drag` | Pointer sequence in the per-tab serial executor |
| `scroll` | Wheel event / `Input.synthesizeScrollGesture` / JS scroll translation |
| `key` | `Input.dispatchKeyEvent` or JS key translation |
| `type` | `Input.insertText`, key events, or JS text insertion for focused editable |
| `click_element` | Runtime element map lookup, scroll into view, then click strategy |
| `click` / `type_text` selector | Runtime DOM lookup, then semantic click/text strategy |

The exact strategy is runtime-owned. The MCP surface remains bounded; it does not
accept arbitrary agent-authored JavaScript.

## Workbench and Thread Binding

The Workbench model remains authoritative for user-facing pane ownership:

- The pane appears only in the Thread that opened it.
- `workbenchOpenByThreadId`, active pane id, stacked/split layout, and close/focus
  behavior remain renderer/Backend Workbench concerns.
- Background Thread `workbench.changed` events update that Thread's stored panes
  but must not alter the visible active Thread.
- BrowserRuntime may remain alive for a Thread whose Workbench is not currently
  visible.

This avoids the failure mode where the agent controls a hidden global browser
that the user cannot find. Every runtime has a visible home: open that Thread's
Workbench pane and the user sees the same page.

## MCP Contract Direction

Keep tool names:

- `tide_open_browser`
- `tide_observe_browser`
- `tide_act_browser`

Output fields such as `status`, `pane`, and `lastAction` remain, but the
semantics are runtime-terminal:

- `tide_act_browser` returns terminal status after BrowserRuntime finishes or
  times out.
- `tide_observe_browser` returns fresh runtime evidence without a renderer pull
  lease.
- Tool calls continue to increment `mcpToolCallCount` and emit Workbench events
  only when stored Thread evidence changes.

## Implementation State

Implemented:

- `BrowserRuntimePort` is the Backend outbound port for open/observe/act/close.
- Electron main owns `BrowserRuntimeHost`, `WebContentsView` presentation,
  hidden capture surface, native overlay view, and per-tab serial execution.
- `tide_open_browser`, `tide_observe_browser`, and `tide_act_browser` route
  through BrowserRuntime.
- Renderer Browser Pane renders browser chrome and a native runtime stage only.
- Hidden observe/action no longer requires a visible Workbench pane or renderer
  Browser Pane mount.

Removed from Browser Use:

- Renderer Browser Pane `<webview>` presentation.
- Background offscreen Browser Pane host.
- `pendingAction` and `pendingCapture` Workbench leases.
- Renderer action/capture result commands.
- Renderer-side Browser Pane action helpers.

Retained outside Browser Use:

- HTML editor preview may still use Electron `<webview>` to render saved local
  HTML files. That is a separate Workbench editor feature, not BrowserRuntime.

## Invariants

- A BrowserRuntime is owned by exactly one `{ threadId, paneId }`.
- A Browser Pane can be visible in at most one presentation host at a time.
- Agent actions do not require the Workbench pane to be mounted or focused.
- Agent actions do not mutate active Thread, active Workbench pane, or Workbench
  open state.
- User-visible pane interactions and agent actions operate on the same live page.
- A BrowserRuntime action reaches terminal status; it does not leave an
  unbounded Workbench-state command lease.
- MCP cannot target a Browser Pane outside the resolved Thread.
- Storage sharing does not grant cross-thread pane access.

## Tests

### Unit tests

- `tide_act_browser` resolves Thread and pane, then calls `BrowserRuntimePort.act`.
- Revision mismatch still returns `workbench_stale_reference`.
- User-controlled pane still refuses agent drive.
- `tide_observe_browser(mode=both)` calls `BrowserRuntimePort.observe` and stores
  returned evidence.
- Background Thread workbench events update only that Thread's pane memory.

### Electron main tests

- Runtime can create, navigate, observe text, and close a `WebContents`.
- Runtime can click/type/scroll while the BrowserWindow is not focused.
- Per-tab serial executor prevents interleaved pointer/key sequences.
- Cross-origin iframe input either targets the correct CDP session or fails
  structurally without hanging.
- Screenshot capture returns fresh pixels after scroll/navigation.

### Renderer integration tests

- Opening a Browser Pane attaches a presentation for the existing runtime.
- Closing Workbench hides presentation but does not close runtime.
- Switching Threads detaches one presentation and attaches the other without
  navigation or state reset.
- Agent overlay/lock is represented by a native overlay view above the browser
  view.
- Take-control cancels queued agent actions and records user control.

### Live regression tests

- CatchTable search/date/person flow can continue while Tide is backgrounded.
- A second browser action is serialized by BrowserRuntime and is not blocked by
  lost renderer state.
- User can open the pane mid-run and see the current page.
- User can take control, interact manually, and prevent further agent input.

## Acceptance Criteria

- `tide_act_browser` no longer depends on a React `<webview>` effect to execute.
- A Browser Pane action works when the Workbench is closed, another Thread is
  active, or the Tide window is not focused.
- `tide_act_browser` returns terminal success/failure with bounded latency.
- `tide_observe_browser(mode=both)` returns fresh pixels from BrowserRuntime.
- Opening the Thread-bound Browser Pane shows the same live page used by the
  agent.
- No private webview adoption API is required.

## Open Questions

- Cross-origin iframe selector routing: coordinate input can target the browser
  surface, but selector/DOM lookup must route to the correct CDP frame/target
  session or fail structurally.
- Whether per-project/per-thread storage partitions become necessary after the
  shared partition policy ships.
