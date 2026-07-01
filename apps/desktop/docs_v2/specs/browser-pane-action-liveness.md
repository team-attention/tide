# Spec: Browser Pane Action Liveness

## Scope

Agent-driven Browser Pane actions (`tide_act_browser` click/type/coordinate input) must
always reach a terminal state, so an agent that opens a browser and acts on it never
hangs the turn. An action can sit `pending` forever either because the pane has no live
`<webview>` to run it or because the renderer starts work but never reports a result.

In scope:
- Guarantee every visible agent-owned Browser Pane has exactly one live `<webview>`
  (foreground workbench OR offscreen background host), for the ACTIVE thread too.
- Guarantee the renderer reports `completed` or `failed` even when action execution,
  post-action settle, or text snapshot hangs.
- Add a backend stale-pending watchdog so a missing renderer result cannot block later
  `tide_act_browser` calls forever.

Out of scope:
- The `executeBrowserWebViewAction` selector/click implementation (unchanged).
- Why a selector fails (that already reports `failed`, which clears `pendingAction`).
- Visible-pane focus/layout behavior.

## Evidence

- Live codex rollout: `tide_open_browser` succeeds (pane "Naver", visible), but every
  `tide_act_browser` returns `status:"pending"` and never settles; codex polls
  `observe_browser` indefinitely, burns ~770K tokens, and falls back to `screencapture`
  (which fails). Agent message: "Tide의 브라우저 액션이 계속 `pending`으로 남습니다."
- A failed selector would report `failed` (clearing the action), so a permanent
  `pending` means the execution effect never ran — no `<webview>` was mounted.
- `<webview>`s mount in only two places (`tide-product-shell.ts`):
  - foreground workbench: renders `appChrome.activeWorkbenchPane` only, and only when
    `workbenchOpen` (the workbench column is presence-gated on `workbenchOpen`).
  - `BackgroundBrowserHost`: renders `backgroundBrowserPanes`.
- `backgroundBrowserPanes` (`product-shell-state.ts:641`) excludes the ACTIVE thread
  entirely (`thread.threadId === activeThreadId ? [] : …`).
- Gap: the active thread's visible Browser Pane, when NOT foregrounded (workbench
  closed, or a different pane is active), is rendered nowhere → no webview → actions
  never execute → `pending` forever. Matches the user's screenshot (right side empty).
- Live CatchTable rollout: `click_at` closed or interacted with a modal, but the
  Desktop action reply remained `pending`; the next `tide_act_browser` was rejected with
  "Browser Pane already has a pending action." This proves the one-live-webview fix is
  necessary but not sufficient: action execution needs a terminal-result harness.

## Decisions

- D1: `backgroundBrowserPanes` includes every visible Browser Pane that is NOT already
  rendered in the foreground — including the active thread's panes. The only pane
  excluded is the one currently foregrounded: `workbenchOpen &&
  appChrome.activeWorkbenchPaneId === pane.paneId` (avoids a duplicate webview for the
  same pane). Non-active threads' panes are always included (current behavior).
- D2: Fix lives entirely in the `product-shell-state.ts` view-model derivation (pure).
  No change to `tide-product-shell.ts` rendering — the existing `BackgroundBrowserHost`
  already executes actions and routes results per-thread.
- D3: Renderer action execution is wrapped as one bounded action transaction:
  `executeBrowserWebViewAction → waitForPostActionSettle → readBrowserWebViewSnapshot`.
  If any step throws or times out, the renderer still reports a `failed`
  `update_browser_action_result` for the same `actionId`.
- D4: Backend treats a pending action older than the watchdog TTL as failed when the
  next `tide_act_browser` tries to act on that pane. The stale action is recorded in
  `lastAction`, cleared from `pendingAction`, and the new action may be queued instead
  of returning "already has a pending action" forever.

## Domain Model

- `backgroundBrowserPanes: ProductShellBackgroundBrowserPane[]` — visible Browser Panes
  (any thread) that need an offscreen live webview because they are not foregrounded.
- `BrowserPane.pendingAction.requestedAt` — backend timestamp used by the stale-pending
  watchdog.
- `BrowserPane.lastAction.status="failed"` — terminal record for a renderer timeout or
  stale pending action.

## Flow

1. Agent opens a Browser Pane (visible) on the active thread; workbench closed / pane
   not active → pane is in `backgroundBrowserPanes` → `BackgroundBrowserWebView` mounts
   a live offscreen `<webview>`.
2. `tide_act_browser` sets `pendingAction`; the offscreen webview's effect runs
   `executeBrowserWebViewAction`, then reports `completed`/`failed` →
   `onBackgroundBrowserActionResult` → backend clears `pendingAction`. Turn proceeds.
3. If the user later foregrounds that pane, it is excluded from the background host (the
   foreground webview takes over); no duplicate.
4. If execution, settle, or snapshot hangs, the renderer reports `failed` after the
   action timeout instead of leaving the pane pending.
5. If no renderer result arrives at all, the next `tide_act_browser` expires the old
   pending action and queues the new one, so the pane never remains permanently locked
   behind a stale `pendingAction`.

## Invariants

- Every visible agent-owned Browser Pane has exactly one live `<webview>` (foreground
  xor background) — never zero (action hangs), never two (double execution).
- An agent browser action on any thread reaches a terminal status; it never stays
  `pending` solely because the pane is not on screen.
- A renderer action transaction reports exactly one terminal result for an `actionId`.
- A stale backend `pendingAction` never causes unbounded
  "Browser Pane already has a pending action" refusals.

## Tests

- An active thread's visible browser pane with workbench CLOSED appears in
  `backgroundBrowserPanes`.
- An active thread's visible browser pane that is NOT the active workbench pane (even
  with workbench open) appears in `backgroundBrowserPanes`.
- The active thread's foregrounded browser pane (`workbenchOpen` &&
  `activeWorkbenchPaneId === paneId`) is EXCLUDED (no duplicate webview).
- Non-active threads' visible browser panes still appear (regression guard).
- Renderer action transaction timeout returns a failed action result with no snapshot.
- A hanging `executeJavaScript` call in the text snapshot path times out instead of
  keeping the action result unresolved.
- A new `tide_act_browser` call after the backend watchdog TTL clears the stale
  `pendingAction`, records it as failed, and queues the new action.

## Implementation Notes

- Single-file change in `product-shell-state.ts` `backgroundBrowserPanes` derivation:
  replace the `activeThreadId` short-circuit with a per-pane "is this pane foregrounded"
  exclusion. Verify live with a codex browser task after the unit tests pass.
- Keep renderer timeout shorter than the backend watchdog TTL. The renderer should be the
  normal terminal-result path; the backend watchdog is a last-resort safety net for a
  lost Desktop reply.
