# Spec: Browser Pane screenshot pulled on demand at observe time (perf)

## Scope

Stop the Browser Pane screenshot churn that pegs the **host renderer** (the React app's
`Tide Helper (Renderer)`) at ~99% CPU / ~1.8 GB after a few browser panes are opened,
making the whole app (keystrokes, pin toggles, everything) sluggish — while keeping the
agent able to see a Browser Pane's pixels **when it needs to**, including a pane driven by a
**backgrounded** thread's agent.

Root cause: every mounted `<webview>` — including the never-unmounted background panes in
`BackgroundBrowserHost` — re-captured a **full-page screenshot** (`capturePage()` →
`toDataURL()` = synchronous PNG-encode on the host renderer's main thread) on **every**
`dom-ready` / `did-finish-load` / `did-stop-loading`. Live pages (google, naver, dev
servers) fire those load events repeatedly (XHR, sub-resource loads, cache-buster
re-fetches), so the cost was `panes × load-event-rate × main-thread PNG encode`. Disabling
`backgroundThrottling` (so off-Space background agents stay responsive) removed the only
brake, so even occluded panes kept encoding. And the captures were almost all **wasted**: the
agent reads pixels only when it calls `tide_observe_browser(vision)`, which is rare.

This slice makes screenshot capture **fully on demand**: it is pulled from the renderer at
the moment the agent observes, and **nowhere else**. The recurring load-event path carries
**text only** (url / title / body, for the address bar + DOM-text observe).

## Evidence

- (pre-fix) `browser-webview-actions.ts` `readBrowserWebViewSnapshot` **unconditionally**
  called `captureBrowserWebViewScreenshot` (capturePage → `toDataURL`), and `browser-pane.tsx`
  wired `emitSnapshot` to `dom-ready` / `did-finish-load` / `did-stop-loading` for BOTH the
  active and the background pane.
- `view-model.ts` `deriveBackgroundBrowserPanes` keeps **every** `visible` browser pane across
  **all** threads mounted in `BackgroundBrowserHost` — multiplying the capture by every pane
  ever opened.
- `main-window.ts` — `backgroundThrottling: false` (intentional, for off-Space background
  notifications) removes the timer/paint brake.
- Live process tree while reproducing: host `Tide Helper (Renderer)` at 99.3% CPU / 1792 MB —
  confirms the host renderer (not the guests) is the bottleneck (main-thread PNG encoding).
- (pre-fix) the backend read a cache, it did not pull: `observeBrowserOutput` attached
  `pane.screenshot` (last pushed) synchronously, and `update_browser_action_result` **dropped**
  the screenshot entirely (`browserPaneActionResultFromData` never parsed it) — so "scroll then
  observe" returned a STALE pre-scroll image even before this change.

## Decisions

- **Single capture point: the observe-time pull.** A screenshot is captured ONLY when the
  agent calls `tide_observe_browser` with `mode=screenshot|both`. There is no eager capture on
  load events, on first settle, or on action completion.
- **Text snapshot stays eager** on every load event (cheap; keeps the address bar + DOM-text
  observe fresh). `readBrowserWebViewSnapshot` is now text-only and NEVER calls `capturePage`.
- **Webviews stay mounted** (no change to `BackgroundBrowserHost`): a backgrounded thread's
  agent must still be able to drive (navigate/scroll via `pendingAction`) AND capture its pane
  on demand. We removed the wasteful capture, not the liveness. Keeping panes mounted is what
  lets the on-demand pull reach any thread's browser.
- **Pull is awaited with a timeout + degrade.** observe sets `pendingCapture`, broadcasts, and
  awaits the renderer's reply (`BROWSER_CAPTURE_PULL_TIMEOUT_MS = 3000`, longer than the
  renderer's own 2 s `capturePage` race). On timeout (pane closed / not painting) it degrades
  to the last successfully-pulled screenshot (`pane.screenshot`), else to DOM text — observe
  never hangs the agent.
- **Fresher, not just cheaper.** Because the pull captures at observe time, the agent always
  sees the *current* page (post-scroll, post-async-content), where the old cache returned the
  last load-event frame.

## Out Of Scope

- Re-enabling `backgroundThrottling` or suspending idle background webviews (separate GPU/paint
  cost, not the host-renderer bottleneck this slice fixes). Now that nothing force-captures the
  background panes, this is a smaller, independent follow-up.

## Domain Model

- `BrowserPaneState.pendingCapture?: { captureId: string; requestedAt: string }` — an in-flight
  observe-driven capture request. Set by the observe pull, cleared on the renderer's reply (or
  on timeout). Mirrors `pendingAction` but for a read-only capture (no driving, no revision
  re-mint — a capture never changes the page).
- `BrowserPaneState.screenshot` keeps its meaning (last captured pixel vision); it is now
  written ONLY by an observe pull's reply, never by a load-event snapshot.

## Contracts

- `BrowserPaneRefDto.pendingCapture?` (renderer-facing) — carries the request to the host so it
  knows which pane + captureId to capture. Kept out of the agent-facing observe output (cleared
  before observe returns).
- New renderer→backend command `update_browser_capture_result` with
  `data: { captureId: string; screenshot?: ProductShellBrowserScreenshot }` — the host's reply
  to a pull. `screenshot` is omitted when the guest could not be captured.

## Flow

1. Agent calls `tide_observe_browser(paneId, mode=screenshot|both)`.
2. `observeBrowserOutput` validates the pane/revision, then (mode ≠ text) calls the puller:
   set `pane.pendingCapture = { captureId, requestedAt }`, emit `workbench_changed` (push to
   the renderer), and `await BrowserCaptureCoordinator.request(captureId, 3000)`.
3. The renderer host (`WorkbenchBrowserPane` for the active pane, `BackgroundBrowserWebView`
   for a background thread's pane) sees `pendingCapture`, calls
   `captureBrowserWebViewScreenshot(webview)`, and replies via
   `update_browser_capture_result { captureId, screenshot }`.
4. The workbench command handler applies `pane.screenshot = screenshot` (refresh the fallback),
   clears `pendingCapture`, and resolves the coordinator → the awaiting observe wakes.
5. observe attaches the FRESH screenshot (or the cached one on timeout) and returns.

Driving (navigate/scroll/click) is unchanged — it rides the existing `pendingAction` lane and
works on mounted background panes, so the "background thread agent scrolls then captures"
scenario works: scroll via `pendingAction`, then observe pulls the post-scroll pixels.

## Invariants

- No `capturePage()` is issued on any `dom-ready` / `did-finish-load` / `did-stop-loading` —
  for any pane, foreground or background, however many times they fire.
- The text fields (url / pageTitle / bodyTextPreview) are still refreshed on every load event.
- A capture never re-mints the pane revision (the page did not change), so an observe→act with
  no navigation between still passes the CAS.
- A pull that never reports resolves to `undefined` within the timeout; observe degrades, it
  never hangs.
- `captureBrowserWebViewScreenshot` is the only path that calls `capturePage`, reached only
  from the `pendingCapture` effect.

## Tests

- `browser-capture-coordinator.test.ts` — request resolves on `resolve()`; resolves `undefined`
  on timeout; `resolve()` of an unknown/late captureId returns false (deterministic fake timer).
- `browser-pane-agent-pixel-vision.test.ts` — observe pulls a FRESH capture and returns it over
  the stale cache; falls back to the cache when the pull yields nothing; `mode=text` never
  pulls; the existing cache-read tests stay green (now `await`ed).
- `browser-webview-actions.test.ts` — `readBrowserWebViewSnapshot` is text-only and NEVER calls
  `capturePage`; `captureBrowserWebViewScreenshot` is the single on-demand pixel path.
- `desktop-product-shell-visual-foundation.test.tsx` — `updateProductShellBrowserCaptureResult`
  emits the `update_browser_capture_result` workbench command routed to the pane's thread.
- Live: `scripts/pw-browser-capture-decoupling-verify.cjs` — wraps every Browser Pane
  `<webview>.capturePage` with a counter, opens a browser pane, drives 3 navigations + 3
  reloads (the load-event storm), and asserts capturePage was called **0** times while the
  navigations really happened; samples `app.getAppMetrics()` renderer CPU (idle).

## Implementation Notes

- Backend: `BrowserCaptureCoordinator` (Map<captureId, {resolve, timer}>, injected into both the
  MCP tool handler and the workbench command handler); `observeBrowserOutput` is async and takes
  an optional `pullScreenshot`; `tide-mcp-tool-handler` owns `pullBrowserScreenshot` (set
  `pendingCapture` → emit → await → clear); `update_browser_capture_result` case +
  `browserPaneCaptureResultFromData` parser; `pendingCapture` serialized in `browserPaneRef` /
  `toWorkbenchPaneRefDto`.
- Renderer: `readBrowserWebViewSnapshot` is text-only (no `captureScreenshot` option); both panes
  gain a `pendingCapture` effect → `captureBrowserWebViewScreenshot` →
  `onBrowserCaptureResult` / `onBackgroundBrowserCaptureResult` →
  `updateProductShell(Background)BrowserCaptureResult` command builder; the per-load capture
  guard (`capturedForLoadRef` + `did-navigate` re-arm) and the action-completion capture are
  removed (pixels now come only from the pull).
- Verification outcome: typecheck 0, suite 1008 pass / 0 fail, live harness ALL CHECKS PASS
  (capturePage 0 across the load storm, renderer CPU idle). The end-to-end pull driven by a
  REAL agent's `tide_observe_browser` is unit-verified at every layer but not exercised by a
  live agent turn in this pass (needs a provider CLI + auth).
