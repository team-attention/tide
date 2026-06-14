# Spec: Browser Pane Agent Computer-Use

## Scope

Turn the Workbench **Browser Pane** into a surface the Agent operates *like a human*:
the Agent can **see the page as pixels**, **move a cursor and click/type at
coordinates**, and the user **watches it happen** with a visible cursor and a
Codex-like "agent is driving" mode on the pane.

This is **approach-1** (Browser-Pane-scoped) and a deliberate stepping stone toward a
future sandboxed virtual-desktop surface (**approach-3**): the pixel-vision +
coordinate-input half is the same interface a virtual desktop will use.

In scope:
- **Vision**: `tide_observe_browser` can return a **screenshot** image of the pane's
  page (in addition to today's DOM text), surfaced to the provider as an image block.
- **Coordinate input** (hybrid with today's selector path): new browser actions
  `click_at` / `move_to` / `scroll` / `key` / `type` that drive the page via real
  `webview.sendInputEvent`, alongside the existing selector `click` / `type_text`.
- **Driving state**: backend-authoritative, per-Pane `agentDriving` + last
  `agentCursor` coordinate, snapshotted to Desktop.
- **Visible theater + lock**: when a *driven* Browser Pane is **on screen**, render an
  animated fake cursor + click ripple, an "agent is driving" pane treatment, and a
  pointer/key **lock** with a **Take control** button (user takeover).

## Evidence

- Current Browser Pane is an Electron `<webview>`
  (`product-shell/workbench/browser-pane.tsx:428`, `createElement("webview", …)`,
  `partition: "persist:tide-workbench-browser"`).
- Current **observe** = `readBrowserWebViewSnapshot` (`browser-pane.tsx:604`) runs
  `executeJavaScript` and returns `{ url, pageTitle, bodyTextPreview }` — **DOM text
  only, no pixels.**
- Current **act** = `executeBrowserWebViewAction` (`browser-pane.tsx:624`) runs
  `document.querySelector(selector).click()` or sets `.value` — **selector-based, no
  coordinates, not a real input event.** Action kinds today: `click`, `type_text`.
- Liveness model: `pendingAction → execute → onBrowserActionResult + snapshot`, with the
  invariant "exactly one live `<webview>` per visible pane (foreground XOR offscreen
  `BackgroundBrowserHost`)" — see `specs/browser-pane-action-liveness.md`.
- Direct motivation: that spec's evidence records a live **codex** run that, when Tide
  browser actions hung, fell back to `screencapture` — i.e. **the Agent wanted pixel
  vision and Tide did not provide it.**
- Focus discipline already exists: `BackgroundBrowserHost` drives non-active-thread
  panes offscreen without stealing focus; memory `v2-multi-thread-routing` fixed a
  prior focus-steal regression. This feature must not regress that.
- MCP surface: tools attach via the Agent Integration to the **Tide MCP Tool Surface**
  (glossary); registry `TIDE_MCP_WORKBENCH_TOOL_NAMES` in
  `backend/application/domains/workbench/workbench.ts`; handler
  `backend/application/services/tide-mcp/tide-mcp-tool-handler.ts`.

## Decisions

- **D0 — Sequencing / isolation.** Precondition **met**: `specs/workbench-dock-parity.md`
  has **landed** on `main` (dock-parity refinement commits through `a870a4f6`), so this
  spec is unblocked. Implementation is sliced **backend-first** to keep each step
  independently testable and to avoid advertising coordinate verbs the renderer cannot yet
  execute:
  - **Slice 1a (done):** backend contract + domain for the coordinate action kinds,
    backend-authoritative `agentDriving` / `agentCursor`, `actBrowserOutput` acceptance of
    the coordinate path (selector path unchanged), and the `release_agent_browser_control`
    command — with behavior tests. Coordinate verbs are NOT yet advertised in the
    `tide_act_browser` MCP schema, and the renderer does not yet execute them, so no live
    agent path changes.
  - **Slice 1b (next):** advertise the coordinate verbs in the `tide_act_browser` schema;
    execute them in the renderer via `webview.sendInputEvent`; add the on-screen
    overlay/lock/Take-control theater; clear `agentDriving` on turn end.
  - **Slice 2 / 3:** screenshot observe (`tide_observe_browser` `mode`), then robust
    offscreen-pane vision (unchanged below).
- **D1 — Vision modality = HYBRID.** The Agent gets **both** a screenshot and DOM text,
  and can act **either** by coordinate (`click_at`, …) **or** by selector (`click`,
  `type_text`). Coordinate/vision is the primary "human" path and the part that
  transfers to approach-3; the selector path is retained as the **reliability
  fallback**. (Rejected: pure computer-use — throws away the reliable selector path and
  is flaky/expensive on real web; selector-only "cursor theater" — the model never
  perceives/aims and it does not transfer to a virtual desktop.)
- **D2 — Driving NEVER changes focus or visibility.** Starting/continuing agent control
  does **not** foreground the pane, switch the active Thread, or change the active
  Workbench tab. The Agent drives the pane's single live `<webview>` wherever it lives
  (foreground *or* offscreen background host). A user looking at another Thread or
  another tab is never yanked away.
- **D3 — The theater is a pure render derivation, on-screen only.** The animated cursor,
  driving-mode treatment, and lock render **iff** the driven pane is the on-screen pane
  (`activeThreadId` match && `workbenchOpen` && `activeWorkbenchPaneId === paneId`).
  Offscreen, the Agent drives **silently** (real input + screenshots, no overlay).
- **D4 — Seamless re-show.** Because it is the same persistent live `<webview>` (not a
  snapshot), switching to a driven pane shows its **current live page state** with no
  replay; if it is still being driven at that moment, the overlay + lock appear from
  then on ("as if nothing happened").
- **D5 — Control model = lock + takeover.** While a foregrounded pane is driven, user
  pointer/key input to the page is blocked (lock veil). A **Take control** button sets
  `agentDriving=false`, cancels any pending agent input on that pane, and unlocks
  immediately. (Lock only exists where the user can see the pane; offscreen panes have
  nothing to lock.)
- **D6 — Coordinate space = screenshot pixels.** The Agent reasons in the pixel space of
  the screenshot it was given. The observe screenshot reports `width`, `height`, and
  `devicePixelRatio`; Tide converts incoming coordinates to `<webview>` **CSS px** for
  `sendInputEvent`. The Agent never sees CSS-vs-device ambiguity.

## Out Of Scope

- The "exactly one live `<webview>` per pane" guarantee and multi-Browser-Pane / launcher
  / Stacked-Split layout — owned by `browser-pane-action-liveness.md` and
  `workbench-dock-parity.md`. This spec **depends on** them.
- Host-machine control (approach-2) and sandboxed virtual desktop (approach-3).
- Native OS dialogs (file upload chooser, right-click native menu), drag-and-drop, and
  multi-touch gestures.

## Domain Model

- `BrowserPane.agentDriving: boolean` — the Agent is currently operating this pane via a
  computer-use turn. Backend-authoritative, per-pane, snapshotted.
- `BrowserPane.agentCursor: { x: number; y: number } | null` — last agent pointer
  position in **screenshot-pixel space**, for the on-screen cursor animation. Cleared
  when driving ends.
- `BrowserPaneScreenshot` — `{ base64: string; mime: "image/png" | "image/jpeg";
  width: number; height: number; devicePixelRatio: number }`.

## Contracts

Shared Contracts (`src/shared/contracts/workbench.ts`) — additive:

- **Observe** result gains optional `screenshot?: BrowserPaneScreenshot`. Observe input
  gains `mode?: "text" | "screenshot" | "both"` (default `"text"` — back-compatible).
- **Browser action kind** union, extended (existing `click`, `type_text` kept):
  - `move_to` `{ x, y }`
  - `click_at` `{ x, y, button?: "left" | "right" | "middle", clickCount?: 1 | 2 }`
  - `scroll` `{ x, y, deltaX, deltaY }`
  - `key` `{ keys: string }`  (e.g. `"Enter"`, `"Cmd+A"`)
  - `type` `{ text }`  (types into the currently focused element — no selector)
  - coordinates are **screenshot-pixel space** (see D6).
- **Pane snapshot** DTO gains `agentDriving: boolean` and `agentCursor: {x,y} | null`.
- **Command** `release_agent_browser_control { paneId }` — user takeover (D5).

Tide MCP Tool Surface — new verbs registered in `TIDE_MCP_WORKBENCH_TOOL_NAMES`,
mirroring dock-parity's tool-registration pattern. The vision capture is exposed through
`tide_observe_browser` (`mode`); the coordinate actions through `tide_act_browser`.

## Flow

1. Agent calls `tide_observe_browser(paneId, mode:"screenshot")` → Tide
   `webview.capturePage()` → returns a `BrowserPaneScreenshot` image block. The Agent
   "sees" the page.
2. Agent calls `tide_act_browser(paneId, { kind:"click_at", x, y })` → backend sets
   `agentDriving=true` + `agentCursor={x,y}`, queues `pendingAction` → the pane's single
   live webview converts to CSS px (D6) and runs `sendInputEvent` → result + fresh
   snapshot settle the action (reuses the liveness pipeline).
3. **If the pane is on screen** (D3): the renderer animates the fake cursor to
   `agentCursor`, shows a click ripple, applies the driving-mode treatment, and locks
   user input. **If offscreen**: steps 1–2 run identically with no overlay; focus is
   untouched (D2).
4. User switches to the driven pane → sees the live current page (D4); if still driving,
   overlay + lock appear from that moment.
5. Turn ends (or no further agent input) → backend sets `agentDriving=false`,
   `agentCursor=null` → overlay + lock clear.
6. User clicks **Take control** → `release_agent_browser_control` → `agentDriving=false`,
   pending agent input on that pane cancelled, unlock (D5).

## Invariants

- Agent vision + input operate on the pane's single live `<webview>` **regardless of
  on-screen visibility** (relies on the one-live-webview guarantee).
- Driving **never** mutates `activeThreadId`, `workbenchOpen`, or `activeWorkbenchPaneId`
  (no focus/visibility side effects — D2).
- The cursor / driving-mode / lock overlay renders **iff** the driven pane is the
  on-screen pane (D3); never for an offscreen or background-thread pane.
- Switching to a driven pane shows live current page state with no snapshot replay (D4).
- The lock blocks user input only on a foregrounded driven pane; **Take control** always
  releases within one snapshot and cancels pending agent input (D5).
- Incoming action coordinates are screenshot-pixel space and converted to webview CSS px
  before `sendInputEvent` (D6).
- Hybrid: the selector `click` / `type_text` path is unchanged and remains available as
  the reliability fallback.

## Tests

- `move_to`/`click_at`/`scroll`/`key`/`type` → `sendInputEvent` invoked with the
  DPR-converted CSS coordinates and correct event type (fake `<webview>`).
- `tide_observe_browser(mode:"screenshot")` → result carries a `screenshot` with
  `width`/`height`/`devicePixelRatio`; MCP output is an image block.
- Driving an **on-screen** pane → snapshot has `agentDriving=true`; renderer shows
  overlay + lock + cursor at `agentCursor`.
- Driving an **offscreen / background-thread** pane → no overlay rendered AND
  `activeThreadId` / `activeWorkbenchPaneId` / `workbenchOpen` unchanged (focus-steal
  regression guard, mirrors `v2-multi-thread-routing`).
- Switching to a driven pane → the pane renders the live `<webview>` (not a stored
  snapshot); overlay appears iff `agentDriving` is still true.
- `release_agent_browser_control` → `agentDriving=false`, pending agent action cleared,
  lock removed.
- Selector `click` / `type_text` path unchanged (regression guard of
  `browser-pane-action-liveness`).
- DPR coordinate conversion is correct at `devicePixelRatio` 1 and 2.

## Implementation Notes

- Coordinate actions → `webview.sendInputEvent` (`mouseMove` / `mouseDown` + `mouseUp` /
  `mouseWheel` / `keyDown` + `char`). Selector actions keep `executeBrowserWebViewAction`.
- Screenshot → `webview.capturePage()` → base64. **Token cost is set by pixel
  dimensions, not file format**: Claude tokenizes an image ≈ `(w×h)/750` and resizes
  anything over ~1.15 MP down server-side, and the computer-use loop sends one
  screenshot per step — so cost multiplies. The real lever is **resolution/DPR**:
  capture/normalize to ~1024 px wide (the background host is already 1024×768) and do
  **not** ship 2× Retina device pixels (4× the tokens for zero accuracy gain — it gets
  resized back anyway). `toJPEG(quality)` shrinks the *payload bytes* and keeps under the
  per-image size limit; it does **not** reduce tokens.
  - **capturePage offscreen — largely mitigated by existing design (was flagged a risk):**
    `BackgroundBrowserHost` already hides via offscreen *positioning*
    (`browser-pane.css:154`: `position:fixed; left:-10000px`, still `display:block`), so
    the webview keeps painting and `capturePage()` should return live pixels — not the
    `display:none` paint-pause case. Residual slice-1 check: confirm **fresh** (not
    stale/blank) frames for a genuinely backgrounded host, and set
    `webPreferences.backgroundThrottling:false` on the webview if Chromium throttles it.
    Graceful fallback (D1 hybrid): a pane that cannot be captured falls back to DOM-text
    observe — pixel vision is only *guaranteed* for the foreground pane.
- Overlay: new renderer component (e.g. `workbench/browser-agent-overlay.tsx` + CSS),
  derived purely from the pane snapshot (`agentDriving`, `agentCursor`); it adds **no**
  focus side effects. Reuse the existing host-coordinate overlay pattern (the browser
  selection toolbar maps webview rect → host coords, `browser-pane.tsx:143`).
- `agentDriving` / `agentCursor` follow dock-parity's backend-authoritative-state +
  command pattern so the post-dock-parity rebase is mechanical.
- Suggested slices: **(1)** coordinate input + `agentDriving` state + on-screen
  overlay/lock/takeover (DOM-text observe only) → live-verify with a codex/claude
  browser task; **(2)** screenshot observe (foreground) + the DPR coordinate contract;
  **(3)** robust offscreen-pane vision (resolve the `capturePage` risk above).
</content>
</invoke>
