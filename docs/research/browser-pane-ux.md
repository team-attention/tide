# Proposal: Browser Pane UX

Improve the Browser Pane so it feels less clunky for navigation and login flows, while keeping the current WKWebView-based architecture intact where it already works.

## Evidence

- `docs/glossary.md` defines `Pane`, `PaneKind`, `FocusArea`, `ModalStack`, `SplitLayout`, `Generation`, and `Render Pane`.
- `crates/tide-app/src/domain/pane/browser.rs` keeps separate state for `url`, `url_input`, `url_input_focused`, `is_first_responder`, `search`, and `render_mode`.
- `crates/tide-app/src/domain/pane/browser.rs` initializes a new empty Browser Pane with `url_input_focused = true`, but `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` and `crates/tide-app/src/application/services/action_service/mod.rs` both clear URL-bar focus on Browser Pane content clicks.
- `crates/tide-app/src/layout_compute.rs` creates and positions the native `WKWebView`, hides it during modal popups and dragging, and only grants first responder when the Browser Pane is focused and not editing the URL bar or search bar.
- `crates/tide-app/src/adapter/outward/platform_adapter/macos/view.rs` routes `performKeyEquivalent`, emits `WebViewFocused` from hit testing, and special-cases `ImeProxyView` versus `WKWebView`.
- `crates/tide-app/src/adapter/outward/platform_adapter/macos/webview.rs` intercepts Cmd+click for new tab handling and owns the `WKWebView` bridge.
- `crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs`, `keyboard_adapter/mod.rs`, and `ime_adapter/mod.rs` split URL-bar, keyboard, and IME routing across multiple paths.
- Verified external examples: JetBrains JCEF and VS Code webviews show that embedded browser surfaces can work, but both still separate embedded content from the host shell. GitHub Desktop and Notion show that browser handoff and explicit open-in-browser actions are useful escape hatches for auth and navigation.
- Apple Password AutoFill documentation shows that credential behavior depends on system credential surfaces and app support, not on Tide-owned code alone.

## Current State

The current design already has the right building blocks, but they are split across too many focus and input paths. The main user-visible cost is focus churn: the URL bar, the Browser Pane content, the search bar, and IME proxy behavior are all coordinated separately, so the user can lose a predictable sense of where keyboard input will land.

The biggest usability hole is first-action ambiguity. A new empty Browser Pane nominally starts with the URL bar focused, but the UI does not strongly advertise that state, and subsequent Browser Pane clicks can move the interaction back toward content/webview focus. That makes empty Browser Pane behavior feel fragile: the user cannot easily tell whether typing will go to the URL bar, the page, or nowhere useful.

## Recommendation

### Quick Wins

1. Add a visible `Open in Browser` action on the Browser Pane chrome.
2. Add a `Copy URL` / `Open externally` affordance next to the URL bar.
3. Treat empty Browser Pane as a first-input state, not a mini webview state: when a new empty Browser Pane opens, focus the URL bar automatically, select its contents or placeholder, and make `Type a URL or search` the default cue.
4. When the user clicks back into an empty navigation-state Browser Pane, route that click to the URL bar instead of silently preferring content/webview focus.
5. Add a strong URL-bar focus affordance, such as a visible border, caret emphasis, and clearer focused styling, so the keyboard landing point is obvious without trial and error.
6. Make URL-bar editing behavior more explicit by keeping the URL bar focused until the user confirms or cancels, instead of letting focus bounce on incidental clicks.
7. Keep the Browser Pane loading state visible while the `WKWebView` is hidden behind overlays or is waiting for its first frame.

These are mostly Tide-controlled and should reduce confusion immediately.

### Medium-Scope Changes

1. Collapse Browser Pane focus transitions into a single browser-focus model so URL-bar editing, search, and page focus stop fighting each other.
2. Reduce responder churn by making focus transitions predictable across `WKWebView`, `ImeProxyView`, and URL-bar editing.
3. Treat login flows as a first-class case: offer a clear handoff to the system browser when a site is likely to work better there than inside the embedded webview.
4. Define explicit first-action rules for each Browser Pane state: empty, loading, navigated, and search-active, so clicks and typing always have a predictable destination.
5. Document the fallback rules for keyboard shortcuts, paste, and navigation so the Browser Pane behaves consistently with host-app expectations.

These are still Tide-controlled, but they need coordinated changes across domain state, layout, and the macOS adapter layer.

### Structural Bets

1. Revisit whether every login and credential flow should stay inside the embedded `WKWebView`, or whether Tide should promote system-browser handoff for selected flows by default.
2. Consider a more host-like shell for navigation-mode browsing, where the content surface is primary and the chrome is intentionally minimal.
3. If password-manager compatibility remains poor after focus cleanup, treat it as a system-bound limitation of WebKit/macOS rather than a pure Tide bug and optimize the handoff path instead.

These are larger bets because they depend on external browser and credential behavior as much as on Tide code.

## Control Split

| Area | Tide controls it? | Notes |
|------|-------------------|-------|
| URL bar behavior | Yes | Tide owns the `url_input` state and focus transitions. |
| Webview framing and hiding | Yes | `layout_compute.rs` decides when the `WKWebView` is visible. |
| Keyboard routing | Mostly yes | Tide owns the adapter path, but macOS responder behavior still matters. |
| Cmd+click new-tab handling | Yes | Intercepted in the macOS webview adapter. |
| Password-manager and autofill behavior | Partly | Influenced by WebKit, macOS credential surfaces, and third-party password managers. |
| Login handoff to system browser | Yes | Tide can offer a clearer escape hatch even when the embedded webview is awkward. |

## Prioritized Next Step

Ship the quick wins first, then simplify Browser Pane focus and responder transitions. If that still leaves password-manager flows awkward, move to an explicit system-browser handoff strategy instead of trying to force every site to behave well inside the embedded webview.
