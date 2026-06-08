# Spec: Browser Pane Action Liveness

## Scope

Agent-driven Browser Pane actions (`tide_act_browser` click/type) must always execute,
so an agent that opens a browser and acts on it never hangs the turn. Today an action
can sit `pending` forever because the pane has no live `<webview>` to run it.

In scope:
- Guarantee every visible agent-owned Browser Pane has exactly one live `<webview>`
  (foreground workbench OR offscreen background host), for the ACTIVE thread too.

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

## Decisions

- D1: `backgroundBrowserPanes` includes every visible Browser Pane that is NOT already
  rendered in the foreground — including the active thread's panes. The only pane
  excluded is the one currently foregrounded: `workbenchOpen &&
  appChrome.activeWorkbenchPaneId === pane.paneId` (avoids a duplicate webview for the
  same pane). Non-active threads' panes are always included (current behavior).
- D2: Fix lives entirely in the `product-shell-state.ts` view-model derivation (pure).
  No change to `tide-product-shell.ts` rendering — the existing `BackgroundBrowserHost`
  already executes actions and routes results per-thread.

## Domain Model

- `backgroundBrowserPanes: ProductShellBackgroundBrowserPane[]` — visible Browser Panes
  (any thread) that need an offscreen live webview because they are not foregrounded.

## Flow

1. Agent opens a Browser Pane (visible) on the active thread; workbench closed / pane
   not active → pane is in `backgroundBrowserPanes` → `BackgroundBrowserWebView` mounts
   a live offscreen `<webview>`.
2. `tide_act_browser` sets `pendingAction`; the offscreen webview's effect runs
   `executeBrowserWebViewAction`, then reports `completed`/`failed` →
   `onBackgroundBrowserActionResult` → backend clears `pendingAction`. Turn proceeds.
3. If the user later foregrounds that pane, it is excluded from the background host (the
   foreground webview takes over); no duplicate.

## Invariants

- Every visible agent-owned Browser Pane has exactly one live `<webview>` (foreground
  xor background) — never zero (action hangs), never two (double execution).
- An agent browser action on any thread reaches a terminal status; it never stays
  `pending` solely because the pane is not on screen.

## Tests

- An active thread's visible browser pane with workbench CLOSED appears in
  `backgroundBrowserPanes`.
- An active thread's visible browser pane that is NOT the active workbench pane (even
  with workbench open) appears in `backgroundBrowserPanes`.
- The active thread's foregrounded browser pane (`workbenchOpen` &&
  `activeWorkbenchPaneId === paneId`) is EXCLUDED (no duplicate webview).
- Non-active threads' visible browser panes still appear (regression guard).

## Implementation Notes

- Single-file change in `product-shell-state.ts` `backgroundBrowserPanes` derivation:
  replace the `activeThreadId` short-circuit with a per-pane "is this pane foregrounded"
  exclusion. Verify live with a codex browser task after the unit tests pass.
