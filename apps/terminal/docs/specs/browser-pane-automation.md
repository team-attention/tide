# Spec: Browser Pane Automation

## Overview

### As-Is

`docs/specs/open-terminal-codex-app.md` already says browser-use should operate Tide's in-app `Browser Pane`, and that Tide should expose Browser Pane and Browser Pane state instead of inventing a second browser automation stack.

`docs/specs/cli-server.md` is older than the current source for this slice. Current Agent Gateway dispatch exposes `browser-observe` and `browser-action` alongside `open-browser`, `capture-pane`, `capture-selection`, and `browser-eval`, so agents have a structured Browser Pane observe/action contract as well as the raw eval escape hatch.

`crates/tide-app/src/domain/pane/browser.rs` already stores committed Browser URL state, loading state, BrowserSnapshot, Browser selection, context-menu target, and native `WKWebView` ownership. `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` already applies Browser bridge messages into that state.

The current Browser Pane bridge already gives Tide a stable place to inject page-side helpers. `crates/tide-app/src/domain/pane/browser.rs` installs the Browser selection bridge through `install_selection_bridge()`, and `request_page_snapshot_refresh()` already uses that bridge to refresh cached BrowserSnapshot state without inventing another native pipeline.

The current render path also constrains how visible automation chrome can work. The evidence gathered for this task shows `layout_compute.rs` and the macOS webview adapter render Tide's WGPU overlays underneath a visible `WKWebView`, so a visible Browser automation marker must live inside the page DOM or as a native sibling view instead of using an ordinary Tide renderer overlay.

### To-Be

Tide keeps a bounded first Browser Pane automation slice for the Agent Gateway:

1. Tide exposes one structured Browser Pane observe command that returns navigation-mode Browser Pane state from existing domain data: committed Browser URL, title, loading state, BrowserSnapshot, Browser selection, and Browser Automation Cursor state.
2. Tide exposes one structured Browser Pane action command that goes beyond raw JavaScript eval while staying small: `navigate`, `move`, `click`, `type`, `press`, and `clear-cursor`.
3. Browser Pane action commands operate the existing in-app `WKWebView` instead of creating a second browser runtime.
4. Browser Pane keeps visible Browser Automation Cursor state in the domain and mirrors it into the page DOM through the existing Browser bridge helper path.
5. This slice stays explicitly below Browser Pane V2 boundaries. It does not imply stronger auth, passkey, download-manager, or deep browser-session behavior.

### Approach

1. Keep one durable Browser Pane term for visible automation state: `Browser Automation Cursor`.
2. Keep this Browser Pane automation spec scoped to navigation-mode-only behavior with explicit Browser Pane V2 boundaries.
3. Add behavior tests before implementation for:
   - structured Browser Pane observation
   - navigation-mode Browser Pane action dispatch
   - Browser Automation Cursor state updates
   - non-browser and render-mode rejection
4. Extend Browser Pane domain state with Browser Automation Cursor storage and DOM-sync helpers that piggyback on the existing Browser bridge installation path.
5. Keep the Agent Gateway CLI/MCP surface on `browser-observe` and `browser-action`.
6. Keep `browser-eval` available for escape hatches, but make the structured contract the preferred Browser Pane automation surface.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/pane/browser.rs` | Owns Browser Automation Cursor state, Browser Pane action helpers, and DOM-sync helper scripts |
| `adapter/inward/cli_adapter/commands.rs` | Exposes structured Browser Pane observe and action commands through the Agent Gateway |
| `adapter/inward/cli_adapter/mcp.rs` | Publishes Browser Pane automation tools to MCP clients |
| `adapter/inward/cli_adapter/client.rs` | Publishes Browser Pane automation commands through `tide cli` |
| `adapter/inward/event_loop_adapter/mod.rs` | Continues to own Browser bridge message application for BrowserSnapshot and Browser selection state |

## Use Cases

### UC-1: ObserveBrowserPaneAutomationState

- **Actor**: Agent
- **Trigger**: Agent calls `browser-observe` for a navigation-mode Browser Pane
- **Precondition**: A targeted Pane exists
- **Flow**:
  1. Tide resolves the target Pane from `pane_id` or the focused Pane.
  2. Tide validates that the target is a navigation-mode `Browser Pane`.
  3. Tide returns a structured Browser observation built from current domain state.
- **Postcondition**: The agent can inspect Browser Pane state without parsing a raw JavaScript response.
- **Business Rules**:
  - BR-1: `browser-observe` must return the targeted `pane_id`, committed Browser URL, loading state, load progress, and back/forward availability.
  - BR-2: `browser-observe` must include cached BrowserSnapshot and Browser selection data when available.
  - BR-3: `browser-observe` must include Browser Automation Cursor state when present.
  - BR-4: `browser-observe` must reject non-browser Panes.
  - BR-5: `browser-observe` must reject render-mode Browser Panes because this slice only covers navigation-mode Browser Pane automation.
  - BR-17: `browser-observe` must include Browser Pane visual fit and Tool Selection Guidance so agents can pick `tide_layout_action` before falling back to BrowserSnapshot-only, app-internal API, URL-parameter, or eval-based workarounds.

### UC-2: ActOnBrowserPaneWithStructuredCommands

- **Actor**: Agent
- **Trigger**: Agent calls `browser-action`
- **Precondition**: A targeted navigation-mode `Browser Pane` exists
- **Flow**:
  1. Tide resolves the target Pane from `pane_id` or the focused Pane.
  2. Tide validates that the target is a navigation-mode `Browser Pane`.
  3. Tide applies one supported Browser action to existing Browser Pane state and, when a native `WKWebView` exists, dispatches the corresponding DOM helper.
  4. Tide returns the targeted `pane_id`, action name, whether it was dispatched to a live webview, and the current Browser Automation Cursor state.
- **Postcondition**: The agent can drive the in-app Browser Pane through a bounded contract instead of opaque JavaScript strings.
- **Business Rules**:
  - BR-6: Supported Browser actions in this slice are `navigate`, `move`, `click`, `type`, `press`, and `clear-cursor`.
  - BR-7: `navigate` must reuse the targeted Browser Pane instead of creating a replacement Pane.
  - BR-8: `move` and `click` must update Browser Automation Cursor state with viewport coordinates and optional label text stored as tool metadata.
  - BR-9: `clear-cursor` must hide Browser Automation Cursor state.
  - BR-10: `click`, `type`, and `press` must request a BrowserSnapshot refresh after dispatch so later observation sees page-side effects.
  - BR-11: `browser-action` must reject unsupported action names.
  - BR-12: `browser-action` must reject render-mode Browser Panes because render panes are outside this navigation-mode automation slice.

### UC-3: MirrorBrowserAutomationCursorIntoBrowserPane

- **Actor**: Agent or system
- **Trigger**: Browser Automation Cursor state changes or Tide reinstalls the Browser bridge after navigation
- **Precondition**: A navigation-mode Browser Pane has Browser Automation Cursor state
- **Flow**:
  1. Tide updates Browser Automation Cursor state in `domain/pane/browser.rs`.
  2. Tide mirrors the Browser Automation Cursor into the page DOM through the Browser bridge helper path when a live `WKWebView` exists.
  3. After navigation or bridge reinstall, Tide reapplies the current Browser Automation Cursor state to the page DOM.
- **Postcondition**: The user can see where the agent is targeting inside the in-app Browser Pane.
- **Business Rules**:
  - BR-13: Visible Browser Automation Cursor must be a cursor-shaped DOM overlay injected through the Browser Pane helper path, not through Tide's normal renderer overlay path, and it must not render optional tool-label text beside the cursor.
  - BR-14: Browser Automation Cursor state must survive Browser bridge reinstall inside the same Browser Pane session.
  - BR-15: Browser Automation Cursor state must clear explicitly on `clear-cursor`, not only when BrowserSnapshot changes.
  - BR-16: Browser Pane click automation must move the visible Browser Automation Cursor in page JavaScript and allow a short visible motion interval before dispatching mouse events, so human-visible agent control cannot skip straight to invisible DOM interaction.

## Invariants

1. **Single Browser runtime**: Browser Pane automation acts on the existing in-app `WKWebView`; Tide does not create a second browser automation stack in this slice.
2. **Navigation-mode scope**: This slice covers navigation-mode Browser Pane automation only. Render-mode Browser panes remain outside the contract.
3. **Browser Pane V2 boundary**: Auth, passkey, download-manager, and deeper browser-session behavior remain explicit Browser Pane V2 work.
4. **Bridge reuse**: Browser Pane automation helpers reuse the existing Browser bridge installation path so BrowserSnapshot and Browser Automation Cursor state stay on one page-side helper surface.
5. **PaneId sync**: Browser Pane automation preserves PaneId sync between `SplitLayout` and `App.panes`.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: ObserveBrowserPaneAutomationState | BR-1 | `browser_pane_automation` | `browser_observe_returns_structured_navigation_state` |
| UC-1: ObserveBrowserPaneAutomationState | BR-2 | `browser_pane_automation` | `browser_observe_includes_snapshot_selection_and_cursor_state` |
| UC-1: ObserveBrowserPaneAutomationState | BR-3 | `browser_pane_automation` | `browser_observe_includes_snapshot_selection_and_cursor_state` |
| UC-1: ObserveBrowserPaneAutomationState | BR-4 | `browser_pane_automation` | `browser_observe_rejects_non_browser_pane` |
| UC-1: ObserveBrowserPaneAutomationState | BR-5 | `browser_pane_automation` | `browser_observe_rejects_render_mode_browser_pane` |
| UC-1: ObserveBrowserPaneAutomationState | BR-17 | `browser_pane_automation` | `browser_observe_includes_visual_fit_tool_selection_guidance` |
| UC-2: ActOnBrowserPaneWithStructuredCommands | BR-6 | `browser_pane_automation` | `browser_action_accepts_each_supported_action_name` |
| UC-2: ActOnBrowserPaneWithStructuredCommands | BR-7 | `browser_pane_automation` | `browser_action_navigate_reuses_the_target_browser_pane` |
| UC-2: ActOnBrowserPaneWithStructuredCommands | BR-8 | `browser_pane_automation` | `browser_action_move_updates_browser_automation_cursor_state` |
| UC-2: ActOnBrowserPaneWithStructuredCommands | BR-9 | `browser_pane_automation` | `browser_action_clear_cursor_hides_browser_automation_cursor_state` |
| UC-2: ActOnBrowserPaneWithStructuredCommands | BR-10 | `browser_pane_automation` | `browser_action_source_requests_snapshot_refresh_after_live_input_dispatch` |
| UC-2: ActOnBrowserPaneWithStructuredCommands | BR-11 | `browser_pane_automation` | `browser_action_rejects_unknown_action_name` |
| UC-2: ActOnBrowserPaneWithStructuredCommands | BR-12 | `browser_pane_automation` | `browser_action_rejects_render_mode_browser_pane` |
| UC-3: MirrorBrowserAutomationCursorIntoBrowserPane | BR-13 | `browser_pane_automation` | `browser_automation_cursor_is_injected_through_the_browser_bridge_dom_path` |
| UC-3: MirrorBrowserAutomationCursorIntoBrowserPane | BR-14 | `browser_pane_automation` | `browser_automation_cursor_state_survives_navigation_reinstall` |
| UC-3: MirrorBrowserAutomationCursorIntoBrowserPane | BR-14 | `browser_pane_automation` | `browser_selection_bridge_reapplies_browser_automation_cursor_on_install` |
| UC-3: MirrorBrowserAutomationCursorIntoBrowserPane | BR-15 | `browser_pane_automation` | `browser_action_clear_cursor_hides_browser_automation_cursor_state` |
| UC-3: MirrorBrowserAutomationCursorIntoBrowserPane | BR-16 | `browser_pane_automation` | `browser_automation_cursor_is_injected_through_the_browser_bridge_dom_path` |

## Location

- `docs/specs/browser-pane-automation.md`
- `crates/tide-app/src/application/behavior_tests/browser_pane_automation.rs`
- `crates/tide-app/src/domain/pane/browser.rs`
- `crates/tide-app/src/adapter/inward/cli_adapter/commands.rs`
- `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs`
- `crates/tide-app/src/adapter/inward/cli_adapter/client.rs`
