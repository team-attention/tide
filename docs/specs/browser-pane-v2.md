# Spec: Browser Pane V2

Define the later Browser Pane capability track that follows Browser Pane UX hardening. This spec is intentionally brief and exists so future work on downloads and stronger browser-session behavior has one concrete starting point.

## Overview

### As-Is

`docs/specs/browser-pane-ux.md` now treats Browser Pane UX hardening and Browser Pane V2 as separate tracks. The hardening work fixes focus ownership, committed Browser URL truthfulness, and explicit external handoff behavior, but it still keeps Browser Pane capability boundaries explicit.

`crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs` still treats non-renderable navigation responses as external handoff via `NSWorkspace`, instead of managing an in-app Browser Pane download flow.

A repository search of `crates/tide-app/src` shows no references to `WKDownloadDelegate`. Tide therefore does not currently implement download-manager integration.

Browser Pane remains a `PaneKind::Browser` backed by `WKWebView`, with Browser URL state, Browser Pane chrome, and explicit external handoff behavior, but without the deeper capability set implied by a full standalone browser.

### To-Be

Browser Pane V2 extends Browser Pane capability without regressing Browser Pane UX hardening:

1. Browser Pane can manage downloadable responses in-app instead of immediately leaving through `NSWorkspace`.
2. Browser Pane owns a clearer session and navigation model for capability-heavy flows such as auth redirects, downloads, and post-auth return navigation.
3. When a capability is still unsupported, Browser Pane keeps explicit external handoff behavior instead of silently implying support.
4. Browser Pane surfaces permission requests (camera, microphone, geolocation) and certificate errors through explicit user prompts instead of silently failing.
5. Browser Pane supports context menus, popup windows (window.open / target=_blank), and cookie/storage management.
6. Browser Pane exposes load progress as a domain-level value for rendering.
7. Browser Pane enables Safari Web Inspector in debug builds for developer tooling.

### Approach

1. Keep Browser Pane UX hardening as a prerequisite. Browser Pane V2 must build on truthful Browser URL state, explicit FocusArea ownership, and explicit fallback behavior.
2. Add a Browser Pane download path that can represent download lifecycle inside the Browser Pane instead of treating every non-renderable response as immediate external handoff.
3. Define what Browser Pane session/history behavior must become first-class for auth and download flows, instead of assuming `WKWebView` defaults are enough.
4. Add behavior tests before implementation so Browser Pane V2 remains separate from ad hoc one-off fixes.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/pane/browser.rs` | Browser Pane capability state, committed Browser URL state, and Browser Pane lifecycle rules |
| `adapter/outward/platform_adapter/macos/webview.rs` | Native `WKWebView` integration, download handling, and capability detection |
| `adapter/inward/event_loop_adapter/` | Browser Pane bridge events and capability-state transitions |
| `application/services/action_service/` | Browser Pane chrome actions and explicit handoff behavior |
| `application/ports/outward/process_port/` | External-browser fallback boundary when Browser Pane capability is unavailable |
| `application/services/workspace_service/` | Browser Pane behavior across Workspace lifecycle transitions |
| `adapter/outward/view/` | Browser Pane chrome rendering including context menus and progress indicators |

## Use Cases

### UC-1: ManageBrowserPaneDownloadsInApp

- **Actor**: User
- **Trigger**: Browser Pane navigation reaches a non-renderable response that should become a download
- **Precondition**: The focused Pane is a Browser Pane in navigation mode
- **Flow**:
  1. Tide detects a download-capable response
  2. Browser Pane transitions into explicit download state
  3. Tide exposes destination, progress, and completion behavior without losing Browser Pane state
- **Postcondition**: The download completes without making Browser Pane feel like a disappearing `WKWebView`
- **Business Rules**:
  - BR-1: Browser Pane V2 does not immediately hand every non-renderable response to `NSWorkspace`
  - BR-2: Browser Pane loading and committed Browser URL state remain coherent throughout download lifecycle changes
  - BR-3: Browser Pane external handoff remains available when in-app download capability is unavailable or fails

### UC-3: StrengthenBrowserPaneSessionState

- **Actor**: User
- **Trigger**: Browser Pane navigation crosses redirects, auth return flows, or download-adjacent navigation
- **Precondition**: The focused Pane is a Browser Pane with active navigation state
- **Flow**:
  1. Tide tracks committed Browser URL and navigation state across capability-heavy flows
  2. Tide preserves intended Browser Pane back/forward and session behavior
  3. Tide keeps Browser Pane chrome truthful after the flow completes
- **Postcondition**: Browser Pane capability-heavy flows feel like one coherent Browser Pane, not disconnected `WKWebView` events
- **Business Rules**:
  - BR-7: Browser Pane committed Browser URL, visible Browser URL, and navigation availability remain aligned after auth and download flows
  - BR-8: Browser Pane capability work preserves Browser Pane UX hardening invariants for FocusArea ownership and Browser URL truthfulness
  - BR-9: Browser Pane capability state survives Workspace and Pane lifecycle transitions only when explicitly specified by the spec

### UC-4: HandleBrowserPanePermissionRequests

- **Actor**: User
- **Trigger**: A web page requests camera, microphone, or geolocation access
- **Precondition**: Focused Pane is a Browser Pane in navigation mode
- **Flow**:
  1. WKWebView fires permission request delegate
  2. Browser Pane shows permission prompt with origin info
  3. User grants or denies
  4. Result sent back to WKWebView
- **Postcondition**: Permission decision is applied; Browser Pane state remains coherent
- **Business Rules**:
  - BR-10: Browser Pane surfaces permission requests through WKUIDelegate instead of silently failing
  - BR-11: Denied or dismissed permission does not break Browser Pane loading or URL state
  - BR-12: Pending permission state clears on navigation to a different origin

### UC-5: HandleBrowserPaneCertificateErrors

- **Actor**: User
- **Trigger**: Browser Pane navigates to a site with an invalid certificate (self-signed, expired)
- **Precondition**: Focused Pane is a Browser Pane in navigation mode
- **Flow**:
  1. WKNavigationDelegate receives authentication challenge
  2. Browser Pane shows certificate warning with host and reason
  3. User chooses to proceed or cancel
  4. Decision sent back via completion handler
- **Postcondition**: User can access self-signed localhost dev servers; Browser Pane state remains truthful
- **Business Rules**:
  - BR-13: Certificate errors surface an explicit user prompt instead of silently failing or showing blank page
  - BR-14: User can proceed past certificate error or cancel navigation; both paths leave Browser Pane state coherent
  - BR-15: Certificate error decision scope is limited to the requesting Pane and does not leak to other Browser Panes

### UC-6: SupportBrowserPaneContextMenu

- **Actor**: User
- **Trigger**: User right-clicks in Browser Pane content area
- **Precondition**: Focused Pane is a Browser Pane
- **Flow**:
  1. JS contextmenu event fires and captures link URL, image URL, selected text
  2. Bridge message sent to domain
  3. Context menu rendered with appropriate actions (copy link, open in new tab, open externally, copy selection)
- **Postcondition**: User has access to standard browser context actions
- **Business Rules**:
  - BR-16: Right-click in Browser Pane content shows context menu with link, image, and selection actions
  - BR-17: Context menu in render-mode Browser Pane omits navigation actions (open in new tab, open externally) since render panes are not user-navigable
  - BR-18: Context menu copy action uses the selection bridge text, not a separate clipboard path

### UC-7: SupportBrowserPanePopups

- **Actor**: User / Web page
- **Trigger**: Web page calls window.open() or user clicks a target=_blank link
- **Precondition**: A Browser Pane is active
- **Flow**:
  1. WKUIDelegate createWebView fires
  2. Instead of loading in same webview, URL is queued for new Browser Pane creation
  3. New Browser Pane opens with the popup URL
  4. No state inherited from parent pane
- **Postcondition**: Popups open as new Browser Panes instead of hijacking the current one
- **Business Rules**:
  - BR-19: window.open() creates a new Browser Pane instead of loading in the same webview
  - BR-20: target=_blank links create a new Browser Pane
  - BR-21: Popup Browser Pane inherits no navigation state (URL, back/forward history) from the parent Pane

### UC-8: ManageBrowserPaneCookiesAndStorage

- **Actor**: User
- **Trigger**: User triggers a clear cookies/storage action on a Browser Pane
- **Precondition**: Focused Pane is a Browser Pane
- **Flow**:
  1. User triggers clear action
  2. Domain sets needs_clear_data flag
  3. Adapter calls WKWebsiteDataStore removeDataOfTypes
  4. Completion resets the flag
- **Postcondition**: Browser Pane cookies and local storage are cleared; navigation state remains coherent
- **Business Rules**:
  - BR-22: Clear cookies/storage action removes cookies, localStorage, sessionStorage, and IndexedDB via WKWebsiteDataStore
  - BR-23: Cookie clear does not break active navigation state (URL, loading, back/forward remain coherent)

### UC-9: ShowBrowserPaneLoadProgress

- **Actor**: System
- **Trigger**: Browser Pane navigation begins
- **Precondition**: Browser Pane is loading a page
- **Flow**:
  1. Adapter polls WKWebView.estimatedProgress
  2. Domain receives progress as f64 0.0–1.0
  3. Renderer can display progress indicator
  4. Progress resets to 0.0 on new navigation
- **Postcondition**: Load progress is available for rendering
- **Business Rules**:
  - BR-24: Browser Pane exposes estimatedProgress as a domain-level f64 field (0.0–1.0)
  - BR-25: Load progress resets to 0.0 on new navigation and reaches 1.0 when loading completes

### UC-10: EnableBrowserPaneDevTools

- **Actor**: Developer
- **Trigger**: Browser Pane WebView is created
- **Precondition**: Application is running in debug build
- **Flow**:
  1. WebView creation checks build configuration
  2. In debug builds, isInspectable is set to true
  3. Safari Web Inspector can attach
- **Postcondition**: Developers can inspect Browser Pane content via Safari Web Inspector in debug builds
- **Business Rules**:
  - BR-26: Browser Pane WebView has isInspectable enabled in debug builds (macOS 13.3+)
  - BR-27: Browser Pane WebView has isInspectable disabled in release builds

## Invariants

1. **Browser Pane UX hardening first**: Browser Pane V2 must preserve Browser Pane UX hardening rules from `docs/specs/browser-pane-ux.md`.
2. **Explicit capability boundary**: Unsupported capability still uses explicit external handoff.
3. **Port boundary compliance**: Download integrations must respect the hexagonal port boundary.
4. **PaneId sync**: Browser Pane V2 work must preserve PaneId sync between `SplitLayout` and `App.panes`.
5. **Permission state coherence**: Pending permission state must not outlive a navigation to a different origin.
6. **Certificate decision isolation**: Certificate error decisions apply only to the requesting Browser Pane.
7. **Popup Pane independence**: A popup Browser Pane inherits no navigation state from the parent Pane.
8. **Load progress range**: Browser Pane load progress is always in [0.0, 1.0] and resets on new navigation.
9. **DevTools build-gated**: isInspectable is enabled only in debug builds, never in release builds.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: ManageBrowserPaneDownloadsInApp | BR-1 | `browser_pane_v2` | `download_response_enters_browser_pane_download_state` |
| UC-1: ManageBrowserPaneDownloadsInApp | BR-2 | `browser_pane_v2` | `download_lifecycle_preserves_browser_pane_loading_and_url_state` |
| UC-1: ManageBrowserPaneDownloadsInApp | BR-3 | `browser_pane_v2` | `download_capability_failure_falls_back_to_explicit_external_handoff` |
| UC-3: StrengthenBrowserPaneSessionState | BR-7 | `browser_pane_v2` | `auth_and_download_flows_keep_browser_url_and_navigation_state_aligned` |
| UC-3: StrengthenBrowserPaneSessionState | BR-8 | `browser_pane_v2` | `browser_pane_v2_preserves_browser_pane_ux_hardening_rules` |
| UC-3: StrengthenBrowserPaneSessionState | BR-9 | `browser_pane_v2` | `workspace_transitions_preserve_only_explicit_browser_pane_capability_state` |
| UC-4: HandleBrowserPanePermissionRequests | BR-10 | `browser_pane_v2` | `permission_request_surfaces_in_browser_pane` |
| UC-4: HandleBrowserPanePermissionRequests | BR-11 | `browser_pane_v2` | `denied_permission_preserves_browser_pane_state` |
| UC-4: HandleBrowserPanePermissionRequests | BR-12 | `browser_pane_v2` | `permission_state_clears_on_origin_change_navigation` |
| UC-5: HandleBrowserPaneCertificateErrors | BR-13 | `browser_pane_v2` | `certificate_error_surfaces_explicit_prompt` |
| UC-5: HandleBrowserPaneCertificateErrors | BR-14 | `browser_pane_v2` | `certificate_proceed_and_cancel_leave_browser_pane_coherent` |
| UC-5: HandleBrowserPaneCertificateErrors | BR-15 | `browser_pane_v2` | `certificate_decision_does_not_leak_to_other_panes` |
| UC-6: SupportBrowserPaneContextMenu | BR-16 | `browser_pane_v2` | `right_click_shows_context_menu_with_actions` |
| UC-6: SupportBrowserPaneContextMenu | BR-17 | `browser_pane_v2` | `render_mode_context_menu_omits_navigation_actions` |
| UC-6: SupportBrowserPaneContextMenu | BR-18 | `browser_pane_v2` | `context_menu_copy_uses_selection_bridge` |
| UC-7: SupportBrowserPanePopups | BR-19 | `browser_pane_v2` | `window_open_creates_new_browser_pane` |
| UC-7: SupportBrowserPanePopups | BR-20 | `browser_pane_v2` | `target_blank_creates_new_browser_pane` |
| UC-7: SupportBrowserPanePopups | BR-21 | `browser_pane_v2` | `popup_browser_pane_inherits_no_parent_state` |
| UC-8: ManageBrowserPaneCookiesAndStorage | BR-22 | `browser_pane_v2` | `clear_cookies_removes_all_website_data` |
| UC-8: ManageBrowserPaneCookiesAndStorage | BR-23 | `browser_pane_v2` | `cookie_clear_preserves_navigation_state` |
| UC-9: ShowBrowserPaneLoadProgress | BR-24 | `browser_pane_v2` | `load_progress_exposed_as_domain_float` |
| UC-9: ShowBrowserPaneLoadProgress | BR-25 | `browser_pane_v2` | `load_progress_resets_on_new_navigation` |
| UC-10: EnableBrowserPaneDevTools | BR-26 | `browser_pane_v2` | `devtools_enabled_in_debug_builds` |
| UC-10: EnableBrowserPaneDevTools | BR-27 | `browser_pane_v2` | `devtools_disabled_in_release_builds` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Domain | `crates/tide-app/src/domain/pane/` | `browser.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/event_loop_adapter/` | `mod.rs` |
| Service | `crates/tide-app/src/application/services/` | `action_service/mod.rs`, `workspace_service/mod.rs` |
| Outward Adapter | `crates/tide-app/src/adapter/outward/platform_adapter/macos/` | `webview.rs`, `webview_delegate.rs` |
| Outward Port | `crates/tide-app/src/application/ports/outward/` | `process_port/mod.rs` |
| View Adapter | `crates/tide-app/src/adapter/outward/view/` | `browser_chrome.rs` |
| Tests | `crates/tide-app/src/application/behavior_tests/` | `browser_pane_v2.rs` |
