# Proposal: Browser Pane UX

Improve the Browser Pane so it feels less like a passive webview and more like a first-class browser context for navigation, input, and explicit handoff, while keeping the current `WKWebView`-based architecture intact where it already works.

## Evidence

- `docs/glossary.md` defines `Pane`, `PaneKind`, `FocusArea`, `ModalStack`, `SplitLayout`, `Generation`, and `Render Pane`.
- `crates/tide-app/src/domain/pane/browser.rs` keeps separate state for `url`, `url_input`, `url_input_focused`, `is_first_responder`, `search`, and `render_mode`.
- `crates/tide-app/src/domain/pane/browser.rs` initializes a new empty Browser Pane with `url_input_focused = true`, and its `content_click_routes_to_url_bar()` / `handle_content_click()` path still routes Browser Pane content clicks back to the Browser URL bar while the Pane is empty, loading, or already editing.
- `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` applies `bp.handle_content_click()` on `PlatformEvent::WebViewFocused`, so page inputs can still lose Browser Pane interaction ownership to the Browser URL bar.
- `crates/tide-app/src/layout_compute.rs` creates and positions the native `WKWebView`, hides it during modal popups and dragging, and only grants first responder when the Browser Pane is focused and not editing the URL bar or search bar.
- `crates/tide-app/src/adapter/outward/platform_adapter/macos/view.rs` routes `performKeyEquivalent`, emits `WebViewFocused` from hit testing, and special-cases `ImeProxyView` versus `WKWebView`.
- `crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs` intercepts Cmd+click for new tab handling and owns the `WKWebView` bridge.
- `crates/tide-app/src/domain/pane/browser.rs` updates the committed Browser URL in `sync_webview_state()`, but leaves `url_input` untouched while `url_input_focused` is true, so Browser Pane content can navigate while the visible Browser URL bar stays stale.
- `crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs` handles non-renderable responses by opening the URL via `NSWorkspace` and canceling Browser Pane navigation instead of managing an in-app Browser Pane download flow.
- `crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs`, `keyboard_adapter/mod.rs`, and `ime_adapter/mod.rs` split URL-bar, keyboard, and IME routing across multiple paths.
- A repository search of `crates/tide-app/src` shows no references to `AuthenticationServices`, `ASAuthorizationWebBrowserPublicKeyCredentialManager`, `passkey`, or `WKDownloadDelegate`, so Tide does not currently implement in-app passkey or download-manager integration.
- External browser-workspace tool documentation describes browser surfaces with navigation, `focus-webview`, history/session handling, DOM interaction, and browser automation, which is evidence for a more browser-like Browser Pane target even if Tide does not deliver full parity in this pass.
- Apple Password AutoFill documentation shows that credential behavior depends on system credential surfaces and app support, not on Tide-owned code alone.

## Current State

The current design already has the right building blocks, but they are split across too many focus and input paths. The main user-visible cost is focus churn: the Browser URL bar, Browser Pane content, the search bar, and IME proxy behavior are all coordinated separately, so the user can lose a predictable sense of where keyboard input will land.

The biggest usability hole is first-action ambiguity. A new empty Browser Pane nominally starts with the Browser URL bar focused, but the UI does not strongly advertise that state, and subsequent Browser Pane clicks can move interaction back toward Browser Pane content or unexpectedly keep it in the Browser URL bar. That makes Browser Pane behavior feel fragile: the user cannot easily tell whether typing will go to the Browser URL bar, the page, or nowhere useful.

The second hole is Browser URL truthfulness. `sync_webview_state()` already tracks committed Browser URL changes, but the visible Browser URL bar can stay stale if the Browser URL bar is still marked focused. That creates the exact user-visible failure where the page changes but the Browser URL does not, which is worse than merely looking like a simple webview because it makes Browser Pane chrome untrustworthy.

The third hole is capability ambiguity. Today non-renderable responses already leave the Browser Pane through `NSWorkspace`, and the codebase has no passkey or `AuthenticationServices` integration. Tide needs to stop implying that the Browser Pane can behave like a full standalone browser in those cases. The correct short-term move is explicit Browser Pane fallback behavior, not accidental silent failure.

## Recommendation

### Quick Wins

1. Add a visible `Open in Browser` action on Browser Pane chrome.
2. Keep the existing `Copy URL` / `Open externally` affordance next to the Browser URL bar aligned with the broader Browser Pane hardening work.
3. Treat empty Browser Pane as a first-input state, not a mini webview state: when a new empty Browser Pane opens, focus the Browser URL bar automatically, select its contents or placeholder, and make `Type a URL or search` the default cue.
4. When the user clicks back into an empty or loading Browser Pane, route that click to the Browser URL bar instead of silently preferring Browser Pane content.
5. Add a strong Browser URL-bar focus affordance, such as a visible border, caret emphasis, and clearer focused styling, so the keyboard landing point is obvious without trial and error.
6. Make Browser URL-bar editing behavior more explicit by keeping the Browser URL bar focused until the user confirms or cancels, instead of letting focus bounce on incidental clicks.
7. Make the visible Browser URL bar truthful after content navigation by synchronizing committed Browser URL changes whenever the user is not actively editing a distinct Browser URL draft.
8. Keep Browser Pane loading state visible while the `WKWebView` is hidden behind overlays or is waiting for its first frame.

These are mostly Tide-controlled and should reduce confusion immediately.

### Medium-Scope Changes

1. Collapse Browser Pane focus transitions into a single browser-focus model so URL-bar editing, search, and page focus stop fighting each other.
2. Reduce responder churn by making focus transitions predictable across `WKWebView`, `ImeProxyView`, and URL-bar editing.
3. Treat login flows and other unsupported Browser Pane capability boundaries as first-class cases: offer a clear handoff to the system browser when a site is likely to work better there than inside the embedded `WKWebView`.
4. Define explicit first-action rules for each Browser Pane state: empty, loading, navigated, search-active, and unsupported-flow, so clicks and typing always have a predictable destination.
5. Document fallback rules for keyboard shortcuts, paste, downloads, and navigation so the Browser Pane behaves consistently with host-app expectations and does not pretend to implement full standalone-browser capability.

These are still Tide-controlled, but they need coordinated changes across domain state, layout, and the macOS adapter layer.

### Structural Bets

1. Add a Browser Pane V2 track for in-app download management instead of relying on `NSWorkspace` fallback for non-renderable responses.
2. Revisit whether every login and credential flow should stay inside the embedded `WKWebView`, or whether Tide should promote system-browser handoff for selected flows by default.
3. Evaluate Browser Pane V2 support for `AuthenticationServices`-driven passkey integration if Tide wants to promise stronger in-app browser behavior on macOS.
4. Consider a more host-like shell for navigation-mode browsing, where the content surface is primary and Browser Pane chrome is intentionally minimal.
5. If password-manager compatibility remains poor after focus cleanup, treat it as a system-bound limitation of WebKit/macOS rather than a pure Tide bug and optimize the handoff path instead.

These are larger bets because they depend on external browser and credential behavior as much as on Tide code.

## Control Split

| Area | Tide controls it? | Notes |
|------|-------------------|-------|
| Browser URL-bar behavior | Yes | Tide owns the `url_input` state and focus transitions. |
| Webview framing and hiding | Yes | `layout_compute.rs` decides when the `WKWebView` is visible. |
| Keyboard routing | Mostly yes | Tide owns the adapter path, but macOS responder behavior still matters. |
| Cmd+click new-tab handling | Yes | Intercepted in the macOS webview adapter. |
| Committed Browser URL truthfulness | Yes | Tide owns `url` versus `url_input` synchronization policy. |
| Download fallback behavior | Yes | Tide already decides when to leave the Browser Pane through `NSWorkspace`; this pass can make that path explicit and state-safe. |
| Password-manager and autofill behavior | Partly | Influenced by WebKit, macOS credential surfaces, and third-party password managers. Tide currently has no in-app passkey integration code. |
| Login handoff to system browser | Yes | Tide can offer a clearer escape hatch even when the embedded webview is awkward. |
| Full in-app passkey and download-manager capability | No, not in this pass | Requires Browser Pane V2 capability work instead of UX-only hardening. |

## Prioritized Next Step

Ship Browser Pane UX hardening first: focus ownership, truthful Browser URL synchronization, and explicit fallback behavior. Then simplify Browser Pane focus and responder transitions. If that still leaves download or password-manager flows awkward, open Browser Pane V2 work instead of trying to hide the capability gap inside the current embedded webview layer.
