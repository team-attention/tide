# Spec: Browser Pane — Live-Pull Vision + opacity:0 Background Render

> Status: **PLAN ONLY (not for implementation yet)**. Exact-plan deliverable from the
> 2026-06-16 investigation + spikes of the blank-observe / pane-thrash bug
> ([[v2-browser-pane-observe-blank]]). Product intent (see pixels + coordinate-click +
> watch + takeover) is owned by `browser-pane-agent-computer-use.md`, unchanged.
> **Supersedes and replaces the rejected OSR/WebContentsView migration plan** (deleted) —
> the capture spikes proved a far smaller fix delivers the same outcome on the existing
> `<webview>`.
>
> **Re-verified against `origin/main` 26e3dee9 (post-rebase, +16 commits, 2026-06-16):**
> all cited line anchors still hold; only `c6203c52` touched a referenced file
> (`workbench-browser-operations.ts`), adding a `userControlled` Take-control gate in the
> act path — folded into Domain Model + D5 below. Core bug premise unchanged
> (`TideObserveBrowserOutput` is still `{kind,threadId,pane}`).

## Scope

Make the agent **genuinely see and operate** the Browser Pane reliably — **foreground AND
background** — while KEEPING the existing renderer-owned `<webview>` (no OSR, no canvas, no
WebContentsView). Two core changes:

1. **`tide_observe_browser` becomes a live pull** — a fresh `capturePage` + DOM read on
   demand, not a passive read of an event-populated cache.
2. **Background panes render via `opacity:0` in-viewport** (replacing the broken
   `left:-10000px` offscreen host), so a backgrounded `<webview>` keeps painting and is
   capturable.

Plus: vision = screenshot + text every observe; revision-CAS/pendingAction ergonomics
cleanup.

## Evidence

(Paths under `apps/desktop/`. Investigation + 3 capture spikes, 2026-06-16, Electron
42.4.0 / macOS arm64; see [[v2-browser-pane-observe-blank]].)

- **The bug.** Across 6 `open_browser`, content reached the agent 1/6, `screenshot` 0/6.
  `observe_browser` is a passive backend read (`tide-mcp-output.ts`
  `TideObserveBrowserOutput = {kind,threadId,pane}`; `workbench-browser-operations.ts:122`)
  and the pane's content is populated **only** by renderer
  `did-finish-load`/`did-stop-loading` listeners attached in a post-mount `useEffect`
  (`browser-pane.tsx:244` fg, `:517` bg) — a static page fires those events before the
  listener attaches → never captured. Background host hides via `left:-10000px`
  (`browser-pane.css:154`).
- **Spike A (capture mechanism).** Native-view capture works **only while visible**:
  visible window ✅, attached `WebContentsView` on-screen ✅; attached view at **off-screen
  bounds ❌ EMPTY**, detached ❌ EMPTY, view in hidden window ❌ ERR. (OSR also works, but
  forces a canvas display — rejected, see below.)
- **Spike B (webview hiding technique) — the key finding.** A `<webview>` kept **in-viewport
  at `opacity:0`** keeps rendering and `capturePage` returns **live, JS-updated pixels** ✅.
  Every other hide fails: **`left:-10000px` (today's code) ❌ ERR**, covered-by-opaque-div ❌
  ERR (occlusion cull), `visibility:hidden` ❌ ERR, `display:none` ❌ EMPTY. (Chromium keeps
  compositing `opacity:0` layers; it stops for the others.)
- **Spike C (robustness).** **Three overlapping `opacity:0` webviews** each captured their
  own distinct color ✅ (no mutual occlusion → multi-pane safe). After **`window.hide()`**
  the `opacity:0` webview **still captured** ✅ (a hidden app window does not pause it).
- **Conclusion.** Keeping `<webview>` is viable for background after all — the only thing
  wrong was the *hiding technique* (`left:-10000px`) plus the passive-observe race. OSR is
  unnecessary; `opacity:0` + live-pull deliver foreground-native + background-pixels with a
  small change.

## Decisions (locked)

- **D1 — Keep the renderer-owned `<webview>`.** No OSR, no canvas, no WebContentsView
  migration. Rationale: the only reason to leave `<webview>` was guaranteed background
  capture; Spike B/C prove `opacity:0` gives exactly that. Foreground stays a real native
  webview (the user's explicit want — "웹뷰로 가고싶은데").
- **D2 — `observe` returns reliably-fresh content (implemented via capture-on-ready).**
  The renderer captures (`capturePage` + `executeJavaScript` DOM read) on `dom-ready` /
  `did-finish-load` / `did-stop-loading` AND immediately when the effect runs against an
  already-loaded guest (`isLoading() === false`) — closing the listener-attach race that
  left the cache empty. With D3 (opacity:0 keeps background guests painting), pane content
  is populated reliably regardless of event timing, so the backend `observe` read is fresh.
  (Considered + deferred — see Implementation Status: a backend→renderer capture-request/
  await round-trip that blocks `observe` until a fresh frame would additionally close the
  sub-~100 ms-after-open window; judged unnecessary for the fix since the spike showed
  capture works whenever triggered.)
- **D3 — Background host hides via `opacity:0` (+`pointer-events:none`), in-viewport.**
  Replace `left:-10000px` (`browser-pane.css` / `BackgroundBrowserHost`). The host occupies
  a real on-screen rect (transparent, click-through) so Chromium keeps compositing it.
- **D4 — Vision = both, every observe.** Screenshot + DOM-text excerpt each call; optional
  `mode:"text"` escape. Capture the viewport, normalize ~1024px wide / DPR 1 (no Retina 2×).
- **D5 — CAS/pendingAction ergonomics cleanup** (no re-mint on no-op act; auto-retry once
  with current revision) — `workbench-command-handler.ts:166,246`. Stops weak-model thrash.
  Build on the existing act-path gate: `c6203c52` already added a `userControlled`
  early-return (`workbench_user_controlled`, `workbench-browser-operations.ts:~204`) that
  softly yields on user Take-control *before* the revision check — same spirit (avoid a
  cryptic stale-reference). D5 refines the **remaining** revision-mismatch path that
  follows it; the two are complementary, not conflicting.

## Out Of Scope

- Product intent (vision/coordinate/watch/takeover) — `browser-pane-agent-computer-use.md`.
- OSR / WebContentsView / canvas streaming (explored, rejected — see Evidence).
- Editor/terminal/diff panes.
- The HTML-file **preview** `<webview>` (added by `c6203c52`) — a separate, non-agent
  surface. D3's `opacity:0` change applies only to the agent Browser Pane's background
  host, not the preview.

## Domain Model

Unchanged ownership: backend authoritative for pane state (`url`, `pageTitle`,
`bodyTextPreview`, `screenshot`, `loading`, `revision`, `agentDriving`, `agentCursor`,
`pendingAction`, `userControlled`); renderer owns the live `<webview>` (foreground pane or
background host). `userControlled` (added by `c6203c52`) gates the act path after a user
"Take control" and is cleared at turn end — see D5. New here: a **capture-request
correlation** so the backend can pull a fresh snapshot on demand.

## Contracts

- **Live-pull capture (new, over the existing channel — no new IPC primitive).** `observe`
  (backend) sets a `captureRequest {paneId, requestId}` on the pane → snapshots to renderer
  → the pane's webview runs `readBrowserWebViewSnapshot` (`browser-webview-actions.ts:90`:
  `capturePage` + `executeJavaScript`) → renderer returns it via the existing
  `browser-snapshot` command tagged with `requestId` → backend correlates (pending-promise
  map) and resolves `observe`. Timeout → `ready:false`.
- **Observe result (amend).** `screenshot` + `bodyTextPreview` every call (D4); add
  `ready:boolean` + `reason?:"loading"|"capture_unavailable"`. Input `mode?:"text"|"both"`
  (default `both`).
- **No backend↔main channel, no main-owned views, no preload bounds-sync** (all of that was
  the OSR plan; gone).

## Flow

1. **Open** — unchanged (`tide_open_browser` creates the pane; the visible pane mounts a
   foreground `<webview>`, non-foreground panes mount in the `opacity:0` background host).
2. **Observe (live pull)** — `tide_observe_browser` → backend `captureRequest` →
   renderer captures the live webview (`capturePage`+DOM) → backend returns image+text+`ready`.
   Works for background panes too (D3 keeps them painting).
3. **Act** — unchanged path (`pendingAction` → renderer `executeBrowserWebViewAction` /
   `sendInputEvent` → result), with D5 ergonomics.
4. **Watch / Take control / overlay** — unchanged (HTML over the webview, as today).

## Invariants

- `observe` returns fresh content (or `ready:false`), never a stale/empty passive cache.
- Every visible-or-background agent-owned pane has one live, **painting** `<webview>`
  (foreground, or `opacity:0` background host) — capturable on demand.
- Backgrounding a pane never moves it off-viewport or to `display:none`/`visibility:hidden`
  (those stop capture — Spike B); only `opacity:0`.
- No focus/visibility side effects (`opacity:0` host is `pointer-events:none`).

## Risks

- **Perf:** N background panes = N live painting pages (GPU/CPU), same cost any
  always-capturable design would have. Bound by the number of live agent browsers; revisit
  if it bites.
- **Extreme window-occlusion — measured, robust (Spike D).** The `opacity:0` webview kept
  capturing live JS-updated pixels through `window.hide()` (Spike C) AND `minimize()`,
  full occlusion by another opaque always-on-top window, and focus loss (Spike D) — all ✅.
  `capturePage` appears to force a frame independent of host-window visibility. Only macOS
  "moved to another Space" is unmeasured (not scriptable); confidence high given the above.
  (Caveat: spikes capture ~1.3s after the state change; long-idle throttling unmeasured but
  irrelevant to an actively-driving agent.)
- **Capture round-trip latency:** observe now awaits a renderer capture; bounded by a
  timeout → `ready:false`. The webview is already mounted (liveness spec), so no React
  attach-race.
- **opacity:0 host rect must stay within the window viewport** (off-viewport stops paint).

## Slices (independently shippable)

1. **Live-pull observe** — capture-request correlation + `observe` returns both+`ready`.
   Fixes the **foreground** blind bug. Verify: agent sees Acme Tasks text+pixels on first
   observe.
2. **opacity:0 background host** — swap `left:-10000px` → `opacity:0;pointer-events:none`
   (`browser-pane.css` + host). Fixes **background** render. Verify: agent observes a
   background-thread browser and gets pixels.
3. **Vision=both + ~1024px/DPR-1 normalize.**
4. **CAS/pendingAction ergonomics (D5).**

## Tests

- Live-pull: `observe` returns fresh screenshot+text with **no prior load event** (fake
  renderer capture) — regression guard for the original bug.
- Background: a pane in the `opacity:0` host returns non-empty capture (guard against a
  regression back to `left:-10000px`).
- not-ready: capture unavailable/timeout → `ready:false`+reason, never silent-empty.
- Act path unchanged (liveness regression guard).
- Architecture boundary: capture stays renderer-side; backend correlates only.

## Implementation Notes

- Live device verification is mandatory (no unit test drives real Chromium capture): repro
  the Acme Tasks delete-bug task with opencode and assert (a) first observe returns
  non-empty pixels+text, single converging loop, and (b) the same with the thread
  **backgrounded** (agent in thread Y while viewing thread X) → pixels still arrive.
- Spikes live at `/tmp/tide-osr-spike*` (Electron 42); keep for the `minimize()` follow-up.
- Field name stays `bodyTextPreview`; `BrowserPaneScreenshot` already exists.

## Implementation Status (2026-06-16 — branch `invest`)

**Implemented + verified (typecheck clean · 909 tests, 907 pass / 2 skip · build green):**
- **Slice 2 — opacity:0 background host.** `browser-pane.css` `.background-browser-host`:
  `left:-10000px` → in-viewport `opacity:0` + `pointer-events:none` + `z-index:5000` (above
  the app's max z-index 1000, so nothing opaque occludes it). Background guests now keep
  compositing → capturable. *This is the primary fix* (the off-screen host had suspended
  background rendering — the dominant cause of 0 screenshots).
- **Slice 1 — capture-on-ready (renderer).** `browser-pane.tsx` foreground + background
  snapshot effects now also listen on `dom-ready` and, when the guest is already loaded
  (`webview.isLoading() === false`, new optional on `BrowserWebViewElement`), capture once
  immediately — closing the listener-attach race that left the cache empty for fast/static
  pages.
- **Slice 3 — vision = both default.** `browserObserveModeFromInput` default `text` → `both`;
  observe tool description updated; the MCP image-block path (`tide-mcp-json-rpc.ts`) already
  existed. Tests updated: the two that pinned the old `text` default now pass `mode:"text"`
  explicitly, plus a new test locks the `both` default.
- **Slice 4 — CAS/pendingAction ergonomics (D5).** `actBrowserOutput`: (a) **no re-mint on
  the act itself** — queuing an action no longer advances the revision (only a real page
  change does: action completion or navigation), so an observe→act keeps its token; (b)
  **bounded auto-retry** — a stale act is rejected EXCEPT when its token is the pane's
  immediately-prior revision from a *settled act-completion* (new domain field
  `priorRevision`, set in `update_browser_action_result`, cleared on navigation), where it
  auto-retries against the current revision. Stops the weak-model stale-reference thrash
  without weakening the CAS for real navigations. New integration test locks both halves;
  the existing arbitrary-stale and post-navigation stale-error tests still pass.

**Deferred (intentionally, with rationale):**
- The **backend→renderer capture-request/await round-trip** (D2 original "live pull" + the
  Contracts "capture-request correlation"): the capture-on-ready + opacity:0 fixes populate
  the cache reliably, so the heavier cross-layer await was judged unnecessary. Residual: an
  `observe` fired within ~100 ms of `open` could read a momentarily-stale cache. Revisit if
  seen live.

**Still required (inherent):** live-device verification — repro the Acme Tasks delete-bug
task with opencode and confirm the agent's first observe returns non-empty pixels+text, in a
**backgrounded** thread too. No unit test drives a real Chromium capture.
