# Spec: Browser Pane V2

Define the later Browser Pane capability track that follows Browser Pane UX hardening. This spec is intentionally brief and exists so future work on downloads, passkeys, and stronger browser-session behavior has one concrete starting point.

## Overview

### As-Is

`docs/specs/browser-pane-ux.md` now treats Browser Pane UX hardening and Browser Pane V2 as separate tracks. The hardening work fixes focus ownership, committed Browser URL truthfulness, and explicit external handoff behavior, but it still keeps Browser Pane capability boundaries explicit.

`crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs` still treats non-renderable navigation responses as external handoff via `NSWorkspace`, instead of managing an in-app Browser Pane download flow.

A repository search of `crates/tide-app/src` shows no references to `AuthenticationServices`, `ASAuthorizationWebBrowserPublicKeyCredentialManager`, `passkey`, or `WKDownloadDelegate`. Tide therefore does not currently implement in-app passkey support or download-manager integration.

Browser Pane remains a `PaneKind::Browser` backed by `WKWebView`, with Browser URL state, Browser Pane chrome, and explicit external handoff behavior, but without the deeper capability set implied by a full standalone browser.

### To-Be

Browser Pane V2 extends Browser Pane capability without regressing Browser Pane UX hardening:

1. Browser Pane can manage downloadable responses in-app instead of immediately leaving through `NSWorkspace`.
2. Browser Pane can integrate supported macOS credential flows strongly enough to make passkey-sensitive sites feel intentional instead of accidental.
3. Browser Pane owns a clearer session and navigation model for capability-heavy flows such as auth redirects, downloads, and post-auth return navigation.
4. When a capability is still unsupported, Browser Pane keeps explicit external handoff behavior instead of silently implying support.

### Approach

1. Keep Browser Pane UX hardening as a prerequisite. Browser Pane V2 must build on truthful Browser URL state, explicit FocusArea ownership, and explicit fallback behavior.
2. Add a Browser Pane download path that can represent download lifecycle inside the Browser Pane instead of treating every non-renderable response as immediate external handoff.
3. Evaluate an outward-adapter path for `AuthenticationServices` and related credential APIs so Browser Pane can support macOS credential surfaces without breaking the port boundary.
4. Define what Browser Pane session/history behavior must become first-class for auth and download flows, instead of assuming `WKWebView` defaults are enough.
5. Add behavior tests before implementation so Browser Pane V2 remains separate from ad hoc one-off fixes.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/pane/browser.rs` | Browser Pane capability state, committed Browser URL state, and Browser Pane lifecycle rules |
| `adapter/outward/platform_adapter/macos/webview.rs` | Native `WKWebView` integration, download handling, and capability detection |
| `adapter/inward/event_loop_adapter/` | Browser Pane bridge events and capability-state transitions |
| `application/services/action_service/` | Browser Pane chrome actions and explicit handoff behavior |
| `application/ports/outward/process_port/` | External-browser fallback boundary when Browser Pane capability is unavailable |
| `application/services/workspace_service/` | Browser Pane behavior across Workspace lifecycle transitions |

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

### UC-2: SupportBrowserPaneCredentialFlows

- **Actor**: User
- **Trigger**: Browser Pane reaches an auth flow that depends on system credential support
- **Precondition**: The focused Pane is a Browser Pane in navigation mode
- **Flow**:
  1. Tide detects whether the credential flow is supported in-app
  2. Supported flows use an explicit Browser Pane capability path
  3. Unsupported flows use explicit external handoff without misleading Browser Pane chrome state
- **Postcondition**: Browser Pane credential behavior is intentional instead of accidental
- **Business Rules**:
  - BR-4: Supported passkey-sensitive flows cross a valid outward-adapter boundary instead of being hard-coded in an inward adapter
  - BR-5: Unsupported credential flows remain explicit and predictable
  - BR-6: Browser Pane never leaves loading, Browser URL, or FocusArea state ambiguous after credential handoff

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

## Invariants

1. **Browser Pane UX hardening first**: Browser Pane V2 must preserve Browser Pane UX hardening rules from `docs/specs/browser-pane-ux.md`.
2. **Explicit capability boundary**: Unsupported capability still uses explicit external handoff.
3. **Port boundary compliance**: Credential and download integrations must respect the hexagonal port boundary.
4. **PaneId sync**: Browser Pane V2 work must preserve PaneId sync between `SplitLayout` and `App.panes`.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1: ManageBrowserPaneDownloadsInApp | BR-1 | `browser_pane_v2` | `download_response_enters_browser_pane_download_state` |
| UC-1: ManageBrowserPaneDownloadsInApp | BR-2 | `browser_pane_v2` | `download_lifecycle_preserves_browser_pane_loading_and_url_state` |
| UC-1: ManageBrowserPaneDownloadsInApp | BR-3 | `browser_pane_v2` | `download_capability_failure_falls_back_to_explicit_external_handoff` |
| UC-2: SupportBrowserPaneCredentialFlows | BR-4 | `browser_pane_v2` | `supported_credential_flow_uses_browser_pane_capability_path` |
| UC-2: SupportBrowserPaneCredentialFlows | BR-5 | `browser_pane_v2` | `unsupported_credential_flow_uses_explicit_external_handoff` |
| UC-2: SupportBrowserPaneCredentialFlows | BR-6 | `browser_pane_v2` | `credential_handoff_preserves_browser_pane_state_truthfully` |
| UC-3: StrengthenBrowserPaneSessionState | BR-7 | `browser_pane_v2` | `auth_and_download_flows_keep_browser_url_and_navigation_state_aligned` |
| UC-3: StrengthenBrowserPaneSessionState | BR-8 | `browser_pane_v2` | `browser_pane_v2_preserves_browser_pane_ux_hardening_rules` |
| UC-3: StrengthenBrowserPaneSessionState | BR-9 | `browser_pane_v2` | `workspace_transitions_preserve_only_explicit_browser_pane_capability_state` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Domain | `crates/tide-app/src/domain/pane/` | `browser.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/event_loop_adapter/` | `mod.rs` |
| Service | `crates/tide-app/src/application/services/` | `action_service/mod.rs`, `workspace_service/mod.rs` |
| Outward Adapter | `crates/tide-app/src/adapter/outward/platform_adapter/macos/` | `webview.rs` |
| Outward Port | `crates/tide-app/src/application/ports/outward/` | `process_port/mod.rs` |
| Tests | `crates/tide-app/src/application/behavior_tests/` | `browser_pane_v2.rs` |
