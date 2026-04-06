# Spec: Browser Pane UX

Codify Browser Pane interaction ownership, address-bar synchronization, Browser Pane chrome actions, loading feedback, and explicit fallback behavior so the Browser Pane behaves predictably across empty, loading, navigated, search-active, and unsupported-flow states without pretending to be a full standalone browser.

## Overview

### As-Is

`crates/tide-app/src/domain/pane/browser.rs` already stores the key Browser Pane state needed for a predictable model: `url`, `url_input`, `url_input_focused`, `loading`, `search`, `needs_initial_navigate`, and `is_first_responder`. A new empty Browser Pane starts with `url_input_focused = true`, while a Browser Pane created with a URL starts with `url_input_focused = false`.

`crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs` routes text to the Browser URL bar only when `url_input_focused` is true, otherwise it consumes text so the native `WKWebView` owns content typing. `crates/tide-app/src/adapter/inward/ime_adapter/mod.rs` mirrors that split for IME commits and preedit.

`crates/tide-app/src/layout_compute.rs` only grants `WKWebView` first responder when the Browser Pane is focused and neither the URL bar nor the search bar is active. The same file also hides the native `WKWebView` behind popups and pane-drag overlays, and only polls `sync_webview_state()` while the native view is visible. That popup-hiding rule is still hand-maintained, so newer `ModalStack` overlays can be missed and render underneath the native Browser Pane view.

Browser Pane click behavior is still split. `crates/tide-app/src/adapter/inward/click_adapter/pane.rs` focuses the URL bar when the user clicks the Browser URL bar chrome. But `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` still routes `PlatformEvent::WebViewFocused` through `bp.handle_content_click()`, and `crates/tide-app/src/application/services/action_service/mod.rs` also applies Browser Pane click routing on pane-routed mouse clicks. That means the Browser Pane does not yet have one explicit first-action rule table across empty, loading, navigated, and search-active states, and page inputs can still lose ownership to the Browser URL bar.

`crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` already renders Browser Pane back, forward, refresh, loading progress, `Copy URL`, and `Open externally` chrome. Manual system-browser handoff is possible in the architecture because `crates/tide-app/src/application/ports/outward/process_port/mod.rs` defines `open_url()` and `crates/tide-app/src/adapter/outward/process_adapter/mod.rs` implements it, and `crates/tide-app/src/application/services/action_service/mod.rs` wires the focused Browser Pane action to that port.

`crates/tide-app/src/domain/pane/browser.rs` updates the committed Browser URL in `sync_webview_state()`, but when `url_input_focused` is true it intentionally does not update `url_input`. That means Browser Pane content can navigate while the visible Browser URL bar remains stale, even though the committed Browser URL already changed.

`crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs` treats non-renderable navigation responses as an external handoff: it opens the response URL with `NSWorkspace` and cancels Browser Pane navigation instead of managing a Browser Pane download flow. But the current bridge message still does not identify the originating `PaneId`, and `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` applies that handoff to `self.focus.focused`, so a background Browser Pane can currently mutate the wrong Browser Pane state in a multi-Pane Workspace. A repository search of `crates/tide-app/src` also shows no references to `AuthenticationServices`, `ASAuthorizationWebBrowserPublicKeyCredentialManager`, `passkey`, or `WKDownloadDelegate`, so Tide does not currently implement in-app passkey or download-manager integration.

`crates/tide-app/src/domain/pane/browser.rs` also moved Browser URL-sync logic into `sync_committed_url_from_navigation()`, but the Browser Pane `generation` bump is still split across helper methods instead of being centralized around the polled Browser Pane state transition. That means Browser Pane dirty tracking is harder to reason about and can drift when loading or back/forward state changes without a URL change.

The Browser Pane target is also broader than a plain embedded surface. External `cmux` documentation describes browser surfaces with navigation, `focus-webview`, history/session handling, DOM interaction, and browser automation. Tide does not need to match that full capability set in this pass, but it does need Browser Pane interaction and fallback rules that feel like a first-class browser context instead of a passive `WKWebView`.

### To-Be

Browser Pane behavior must become state-driven, address-bar-truthful, and explicit about capability boundaries:

1. Empty Browser Pane and loading Browser Pane are chrome-first states. Clicks and typing default to the URL bar until the user confirms navigation or explicitly activates a different Browser Pane target.
2. Navigated Browser Pane is content-first. After successful navigation, Browser Pane content interaction defaults to the native `WKWebView` unless the user explicitly focuses the URL bar or the search bar.
3. Search-active Browser Pane always routes text input to the search bar before the URL bar or the native `WKWebView`.
4. URL-bar editing persists across incidental Browser Pane clicks until the user confirms or cancels editing, instead of silently bouncing focus back to Browser Pane content.
5. Browser Pane chrome keeps explicit `Copy URL` and `Open externally` actions. External handoff is manual-only in this pass.
6. Any `ModalStack` popup must hide the native Browser Pane view so Tide-rendered overlays stay visually above Browser Pane content.
7. Browser Pane loading feedback remains visible even when the native `WKWebView` is hidden behind overlays or is waiting for its first usable frame.
8. Browser Pane keeps separate committed-URL and editable-URL state, but the visible Browser URL bar must stay truthful: content-driven navigation updates the committed Browser URL immediately, and the visible Browser URL bar updates whenever the user is not actively editing a distinct Browser URL draft.
9. Unsupported Browser Pane capability gaps are explicit in this pass. Non-renderable responses use an explicit external handoff path routed to the originating Browser Pane by `PaneId`, and passkey or AuthenticationServices-sensitive flows are treated as Browser Pane V2 capability work rather than silently implied Browser Pane guarantees.
10. Browser Pane dirty tracking stays centralized: `sync_webview_state()` owns the `generation` bump for Browser Pane state it polls from the native `WKWebView`, including committed-URL, loading, and navigation-availability changes.

### Approach

1. Add this spec so Browser Pane UX rules are explicit and traceable.
2. Extend the Browser Pane research notes so later test and code changes are grounded in current Tide evidence and the broader `cmux` browser-surface target.
3. Add Browser Pane behavior tests for each Browser Pane state, Browser URL synchronization rule, and Browser Pane chrome action before implementation.
4. Consolidate Browser Pane first-action routing across Browser Pane state, text routing, keyboard handling, IME routing, pane-click handling, and `WKWebView` first-responder sync.
5. Make committed Browser URL updates and visible Browser URL-bar updates explicit so Browser Pane navigation cannot leave stale Browser URL chrome behind.
6. Keep Browser Pane chrome hit testing and rendering aligned with the existing `Copy URL` and `Open externally` actions, routed through valid inward ports and `ProcessPort::open_url()`.
7. Route Browser Pane native-view hiding through one shared overlay check so every `ModalStack` popup obscures the native `WKWebView` consistently.
8. Preserve Browser Pane loading feedback when the native `WKWebView` is hidden or still waiting for its first frame.
9. Keep unsupported download and passkey flows explicit: this pass hardens Browser Pane fallback behavior, while in-app download management and AuthenticationServices integration remain Browser Pane V2 work.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/pane/browser.rs` | Browser Pane state: URL bar focus, loading, navigation, search state, native responder tracking |
| `adapter/inward/text_routing_adapter/` | Resolves Browser Pane text-input destination |
| `adapter/inward/keyboard_adapter/` | Resolves Browser Pane keyboard shortcuts and URL-bar key handling |
| `adapter/inward/ime_adapter/` | Routes IME commit and preedit into the Browser Pane URL bar when appropriate |
| `adapter/inward/event_loop_adapter/` | Applies `WebViewFocused` and platform-driven Browser Pane focus changes |
| `application/services/action_service/` | Applies pane-routed mouse-click effects and Browser Pane action dispatch |
| `adapter/inward/click_adapter/` | Browser Pane chrome hit testing and Browser Pane nav/action clicks |
| `layout_compute.rs` | Native `WKWebView` visibility, loading sync, and first-responder transitions |
| `adapter/outward/view/chrome/tab_bar.rs` | Browser Pane chrome rendering, loading affordance, and action placement |
| `adapter/outward/platform_adapter/macos/webview.rs` | Native navigation-response fallback for downloads and other unsupported responses |
| `application/ports/outward/process_port/` | Manual external-browser handoff boundary |

## Use Cases

### UC-1: RouteFirstActionInEmptyOrLoadingBrowserPane

- **Actor**: User
- **Trigger**: The user types, pastes, clicks Browser Pane content, or focuses a newly created or loading Browser Pane
- **Precondition**: The focused Pane is a Browser Pane in an empty or loading state, and the search bar is not active
- **Flow**:
  1. Browser Pane receives the first action
  2. Tide resolves the Browser Pane state before routing the action
  3. Tide keeps the URL bar as the active Browser Pane text target
  4. Tide renders Browser Pane chrome so the URL-bar landing point is visible
- **Postcondition**: The first action is routed to the Browser URL bar instead of silently falling into Browser Pane content
- **Business Rules**:
  - BR-1: A new empty Browser Pane starts with the URL bar focused
  - BR-2: Typing or pasting in an empty Browser Pane routes text to the Browser URL bar
  - BR-3: Typing or pasting in a loading Browser Pane routes text to the Browser URL bar
  - BR-4: Clicking Browser Pane content in an empty Browser Pane restores or preserves Browser URL-bar focus instead of switching to native content focus
  - BR-5: Clicking Browser Pane content in a loading Browser Pane preserves Browser URL-bar focus until navigation completes or the user explicitly focuses another Browser Pane target

### UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane

- **Actor**: User
- **Trigger**: The user types, pastes, clicks Browser Pane content, or invokes a Browser Pane search action
- **Precondition**: The focused Pane is a navigated Browser Pane or a search-active Browser Pane
- **Flow**:
  1. Tide resolves search-bar precedence first
  2. If the search bar is active, Tide routes text to the search bar
  3. Otherwise, Tide resolves whether the user explicitly focused the URL bar
  4. If the URL bar is not active, Tide keeps Browser Pane content as the default destination after navigation
- **Postcondition**: Browser Pane text and click routing is predictable in navigated and search-active states
- **Business Rules**:
  - BR-6: Search-active Browser Pane always routes text input to the search bar before the URL bar or Browser Pane content
  - BR-7: A navigated Browser Pane defaults clicks in Browser Pane content to the native `WKWebView`
  - BR-8: A navigated Browser Pane defaults typing to Browser Pane content when the URL bar and search bar are both inactive
  - BR-9: `Cmd+L` explicitly focuses the Browser URL bar in a navigated Browser Pane
  - BR-10: Clicking the Browser URL bar explicitly switches the Browser Pane back to URL-bar editing from a navigated state and positions the cursor relative to the rendered Browser URL text

### UC-3: PreserveBrowserUrlBarEditing

- **Actor**: User
- **Trigger**: The user edits the Browser URL bar, then clicks elsewhere in the same Browser Pane before confirming or cancelling
- **Precondition**: The focused Pane is a Browser Pane and the Browser URL bar is already focused
- **Flow**:
  1. User changes Browser URL-bar contents
  2. User clicks in Browser Pane content or Browser Pane chrome without confirming navigation
  3. Tide evaluates whether the click is an explicit focus change or an incidental click
  4. Tide preserves Browser URL-bar editing until the user confirms navigation, cancels editing, or explicitly changes Browser Pane target
- **Postcondition**: Browser URL-bar editing does not bounce away on incidental Browser Pane clicks
- **Business Rules**:
  - BR-11: Incidental Browser Pane content clicks do not clear Browser URL-bar focus while the user is actively editing the Browser URL bar
  - BR-12: Confirming navigation updates the Browser Pane URL and exits Browser URL-bar editing
  - BR-13: Cancelling Browser URL-bar editing restores Browser URL-bar text from the current Browser Pane URL
  - BR-14: Search-bar focus still overrides Browser URL-bar editing for Browser Pane text routing when the search bar is explicitly active

### UC-4: InvokeBrowserPaneChromeActions

- **Actor**: User
- **Trigger**: The user clicks a Browser Pane chrome action
- **Precondition**: The focused Pane is a Browser Pane in navigation mode
- **Flow**:
  1. Tide hit-tests the Browser Pane chrome action
  2. Tide dispatches the Browser Pane action through inward ports and services
  3. Tide updates Browser Pane state or invokes outward ports as needed
- **Postcondition**: Browser Pane chrome actions complete without bypassing the port boundary
- **Business Rules**:
  - BR-15: Browser Pane chrome renders a `Copy URL` action next to the Browser URL bar
  - BR-16: Browser Pane chrome renders an `Open externally` action next to the Browser URL bar
  - BR-17: `Copy URL` copies the current Browser Pane URL state, preferring selected Browser URL-bar text or the current Browser URL-bar input while editing
  - BR-18: `Open externally` calls `ProcessPort::open_url()` with the current Browser Pane URL state, preferring the current Browser URL-bar input while editing
  - BR-19: External-browser handoff is manual-only; Tide does not auto-open likely auth flows in this pass

### UC-5: PreserveBrowserPaneLoadingFeedback

- **Actor**: System
- **Trigger**: Browser Pane loading state changes while overlays, pane dragging, or first-frame timing affect native `WKWebView` visibility
- **Precondition**: A Browser Pane is loading or waiting for its first usable frame
- **Flow**:
  1. Tide tracks Browser Pane loading state independently from native `WKWebView` visibility
  2. Browser Pane chrome continues rendering loading feedback while the native view is hidden or not yet usable
  3. Browser Pane loading feedback clears when the Browser Pane finishes loading
- **Postcondition**: Browser Pane loading feedback remains truthful even when the native `WKWebView` is temporarily hidden
- **Business Rules**:
  - BR-20: Browser Pane loading feedback remains visible while a popup or pane-drag overlay hides the native `WKWebView`
  - BR-21: Browser Pane loading feedback remains visible while the Browser Pane is waiting for its first usable frame
  - BR-22: Browser Pane loading feedback clears when loading completes

### UC-6: SynchronizeCommittedBrowserUrlAndVisibleBrowserUrlBar

- **Actor**: User
- **Trigger**: Browser Pane content navigation changes the committed Browser URL while the Browser URL bar may or may not be focused
- **Precondition**: The focused Pane is a Browser Pane in navigation mode and the native `WKWebView` reports a new committed URL
- **Flow**:
  1. Browser Pane content navigation commits a new Browser URL
  2. Tide updates the committed Browser URL immediately
  3. Tide resolves whether the Browser URL bar is showing a real draft or merely stale Browser URL text
  4. Tide updates the visible Browser URL bar whenever the user is not actively editing a distinct Browser URL draft
- **Postcondition**: Browser Pane chrome remains truthful after content-driven navigation
- **Business Rules**:
  - BR-23: Browser Pane content navigation updates the committed Browser URL even when Browser URL-bar focus changed recently
  - BR-24: Browser Pane content navigation updates the visible Browser URL bar when the user is not actively editing a distinct Browser URL draft
  - BR-25: Browser Pane chrome actions and external handoff use the committed Browser URL after content-driven navigation unless the user is actively editing a distinct Browser URL draft
  - BR-26: A Browser Pane state change reported through `sync_webview_state()` bumps `generation` exactly once, including loading and back/forward availability changes that occur alongside or without a URL change

### UC-7: HandleUnsupportedBrowserPaneFlowsExplicitly

- **Actor**: System
- **Trigger**: Browser Pane navigation reaches a non-renderable response or a capability boundary that Tide does not implement in-app in this pass
- **Precondition**: The focused Pane is a Browser Pane in navigation mode
- **Flow**:
  1. Tide detects that the Browser Pane cannot complete the flow inside the embedded `WKWebView`
  2. Tide uses an explicit external handoff or Browser Pane chrome affordance instead of silently pretending the Browser Pane supports the flow
  3. Tide preserves Browser Pane FocusArea, loading, and committed Browser URL state coherently after the handoff
- **Postcondition**: Unsupported Browser Pane flows fail predictably and visibly instead of leaving the Browser Pane in an ambiguous state
- **Business Rules**:
  - BR-27: Browser Pane non-renderable responses use an explicit external handoff path and must not leave Browser Pane loading feedback stuck on
  - BR-28: Download-triggered external handoff carries the originating `PaneId` and must update that Browser Pane even when another Pane is focused
  - BR-29: Browser Pane does not promise in-app passkey or AuthenticationServices behavior in this pass; unsupported auth flows rely on explicit external handoff
  - BR-30: External handoff preserves coherent Browser Pane chrome state, FocusArea, and committed Browser URL state after the handoff

## Invariants

1. **Search precedence**: `search_focus` remains the highest-priority Browser Pane text target.
2. **Explicit external handoff**: Browser Pane system-browser handoff only occurs from an explicit Browser Pane chrome action or an explicit unsupported-response fallback path in this pass.
3. **Responder consistency**: Browser Pane native first responder must not activate while the Browser URL bar or search bar is the active Browser Pane text target.
4. **Focus-area consistency**: Browser Pane clicks still preserve the existing FocusArea rules for Stage versus Dock.
5. **PaneId sync**: Browser Pane UX changes preserve the PaneId sync invariant between `SplitLayout` and `App.panes`.
6. **Committed URL truthfulness**: `BrowserPane.url` remains the source of truth for committed Browser URL state even when Browser URL-bar draft text is temporarily different.
7. **Explicit capability boundary**: This pass can improve Browser Pane fallback behavior, but it does not imply full in-app download-manager or passkey capability.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: RouteFirstActionInEmptyOrLoadingBrowserPane | BR-1 | `browser_pane_ux` | `new_empty_browser_pane_starts_with_url_bar_focused` |
| UC-1: RouteFirstActionInEmptyOrLoadingBrowserPane | BR-2 | `browser_pane_ux` | `typing_in_empty_browser_pane_routes_text_to_url_bar` |
| UC-1: RouteFirstActionInEmptyOrLoadingBrowserPane | BR-3 | `browser_pane_ux` | `typing_in_loading_browser_pane_routes_text_to_url_bar` |
| UC-1: RouteFirstActionInEmptyOrLoadingBrowserPane | BR-4 | `browser_pane_ux` | `clicking_empty_browser_pane_content_preserves_url_bar_focus` |
| UC-1: RouteFirstActionInEmptyOrLoadingBrowserPane | BR-5 | `browser_pane_ux` | `clicking_loading_browser_pane_content_preserves_url_bar_focus` |
| UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane | BR-6 | `browser_pane_ux` | `search_active_browser_pane_routes_text_to_search_bar` |
| UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane | BR-7 | `browser_pane_ux` | `clicking_navigated_browser_pane_content_focuses_webview` |
| UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane | BR-8 | `browser_pane_ux` | `typing_in_navigated_browser_pane_without_url_focus_is_consumed_by_content` |
| UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane | BR-9 | `browser_pane_ux` | `cmd_l_focuses_the_browser_url_bar_after_navigation` |
| UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane | BR-10 | `browser_pane_ux` | `clicking_browser_url_bar_restarts_url_editing_after_navigation` |
| UC-2: RouteFirstActionInNavigatedOrSearchActiveBrowserPane | BR-10 | `browser_pane_ux` | `clicking_browser_url_bar_positions_cursor_after_browser_actions` |
| UC-3: PreserveBrowserUrlBarEditing | BR-11 | `browser_pane_ux` | `incidental_browser_content_click_does_not_cancel_url_bar_editing` |
| UC-3: PreserveBrowserUrlBarEditing | BR-12 | `browser_pane_ux` | `confirming_browser_navigation_exits_url_bar_editing` |
| UC-3: PreserveBrowserUrlBarEditing | BR-13 | `browser_pane_ux` | `cancelling_browser_url_bar_editing_restores_current_url` |
| UC-3: PreserveBrowserUrlBarEditing | BR-14 | `browser_pane_ux` | `search_focus_overrides_browser_url_bar_text_routing` |
| UC-4: InvokeBrowserPaneChromeActions | BR-15 | `browser_pane_ux` | `browser_chrome_renders_copy_url_action` |
| UC-4: InvokeBrowserPaneChromeActions | BR-16 | `browser_pane_ux` | `browser_chrome_renders_open_externally_action` |
| UC-4: InvokeBrowserPaneChromeActions | BR-17 | `browser_pane_ux` | `copy_url_action_copies_the_current_browser_url` |
| UC-4: InvokeBrowserPaneChromeActions | BR-17 | `browser_pane_ux` | `copy_url_action_prefers_selected_url_input_while_editing` |
| UC-4: InvokeBrowserPaneChromeActions | BR-18 | `browser_pane_ux` | `open_externally_action_uses_process_port_open_url` |
| UC-4: InvokeBrowserPaneChromeActions | BR-18 | `browser_pane_ux` | `open_externally_action_prefers_url_input_while_editing` |
| UC-4: InvokeBrowserPaneChromeActions | BR-19 | `browser_pane_ux` | `browser_pane_does_not_auto_handoff_auth_flows` |
| UC-5: PreserveBrowserPaneLoadingFeedback | BR-20 | `browser_pane_ux` | `context_comment_composer_hides_browser_native_view_for_overlays` |
| UC-5: PreserveBrowserPaneLoadingFeedback | BR-21 | `browser_pane_ux` | `loading_indicator_stays_visible_while_waiting_for_first_frame` |
| UC-5: PreserveBrowserPaneLoadingFeedback | BR-22 | `browser_pane_ux` | `loading_indicator_clears_when_browser_navigation_finishes` |
| UC-6: SynchronizeCommittedBrowserUrlAndVisibleBrowserUrlBar | BR-23 | `browser_pane_ux` | `content_navigation_updates_the_committed_browser_url` |
| UC-6: SynchronizeCommittedBrowserUrlAndVisibleBrowserUrlBar | BR-24 | `browser_pane_ux` | `content_navigation_updates_visible_browser_url_when_not_editing_a_distinct_draft` |
| UC-6: SynchronizeCommittedBrowserUrlAndVisibleBrowserUrlBar | BR-25 | `browser_pane_ux` | `browser_chrome_actions_use_the_committed_browser_url_after_content_navigation` |
| UC-6: SynchronizeCommittedBrowserUrlAndVisibleBrowserUrlBar | BR-26 | `browser_pane_ux` | `polled_browser_state_changes_bump_generation_once` |
| UC-7: HandleUnsupportedBrowserPaneFlowsExplicitly | BR-27 | `browser_pane_fallbacks` | `external_handoff_requires_some_browser_url_state` |
| UC-7: HandleUnsupportedBrowserPaneFlowsExplicitly | BR-28 | `browser_pane_fallbacks` | `download_external_handoff_updates_originating_background_browser_pane` |
| UC-7: HandleUnsupportedBrowserPaneFlowsExplicitly | BR-29 | `browser_pane_fallbacks` | `external_handoff_prefers_url_bar_draft_when_browser_is_editing` |
| UC-7: HandleUnsupportedBrowserPaneFlowsExplicitly | BR-30 | `browser_pane_fallbacks` | `external_handoff_prefers_committed_browser_url_when_browser_is_not_editing` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Domain | `crates/tide-app/src/domain/pane/` | `browser.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/text_routing_adapter/` | `mod.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/keyboard_adapter/` | `mod.rs`, `preview.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/ime_adapter/` | `mod.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/event_loop_adapter/` | `mod.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/click_adapter/` | `hit_test.rs`, `pane.rs` |
| Service | `crates/tide-app/src/application/services/action_service/` | `mod.rs` |
| Outward View | `crates/tide-app/src/adapter/outward/view/chrome/` | `tab_bar.rs` |
| Outward Adapter | `crates/tide-app/src/adapter/outward/platform_adapter/macos/` | `webview.rs` |
| Outward Port | `crates/tide-app/src/application/ports/outward/process_port/` | `mod.rs` |
| Outward Adapter | `crates/tide-app/src/adapter/outward/process_adapter/` | `mod.rs` |
| Layout | `crates/tide-app/src/` | `layout_compute.rs` |
| Tests | `crates/tide-app/src/application/behavior_tests/` | `browser_pane_ux.rs` |
