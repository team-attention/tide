# Spec: Browser Pane Agent Pixel Vision

## Overview

### As-Is

A Wrapped Agent driving a v1 Browser Pane already **operates like a human** and has a
**structured** view of the page, but it cannot **see the page as pixels**:

- Observe (`tide_browser_observe` → Gateway `browser-observe` → `cli_browser_observe`,
  `cli_adapter/commands.rs`) returns only **BrowserSnapshot** (page text + metadata) and
  **Browser Page Map** (regions/interactables with generation-scoped refs), captured from
  the `WKWebView` bridge. `detail` is `compact|full` over that *text* model.
- Action (`tide_browser_action`) already drives the page at viewport coordinates and via
  Browser Page Map `target_ref`s, moving a visible **Browser Automation Cursor**
  (`domain/pane/browser.rs`), under **Agent Browser Control Mode** (the authorized,
  wrapper-managed driving state), inside a **Browser Operation**. Background (non-focused)
  Browser Panes are already drivable offscreen.
- The macOS `WKWebView` adapter (`adapter/outward/platform_adapter/macos/webview.rs`)
  exposes navigation, bridge eval, and content state, but **no snapshot-to-image**.

So the agent perceives only what the DOM bridge encodes. Canvas/image/video content,
visual-only layout cues, and "does this actually look right" verification are invisible.
This is the v1 counterpart of the gap the v2 Desktop app closes with its computer-use
**screenshot** observe (`apps/desktop/docs_v2/specs/browser-pane-agent-computer-use.md`).

### To-Be

`tide_browser_observe` can additionally return a **Browser Pane Screenshot** — a raster
image of the rendered `WKWebView` page — surfaced to the Wrapped Agent as an MCP **image
content block**, alongside the existing BrowserSnapshot / Browser Page Map. The agent
reasons in the screenshot's viewport pixel space, which is the **same** space its existing
coordinate actions and Browser Automation Cursor use, so "see → aim → act" closes without
a coordinate-space translation step. Pixel vision is the v1 mirror of the v2 screenshot
slice; the cross-app **contract shape** is mirrored per language (no shared code): image
bytes + `width`/`height`/`device_scale`, and an observe `mode` of `text | screenshot |
both` defaulting to `text` (back-compatible).

### Approach

1. **Capability (platform):** add a WKWebView snapshot method to the webview adapter via
   `takeSnapshotWithConfiguration:completionHandler:` → PNG bytes + pixel size + backing
   `device_scale`. Capture is **viewport-fit** (the visible page rect, matching the
   coordinate space of actions), normalized toward ~1024 px wide and **not** shipped at 2×
   device pixels (token cost scales with pixels, not bytes — same lever as v2).
2. **Port:** expose capture through an outward port (mirrors how the bridge/observe data
   already crosses the boundary), so the domain/service stays adapter-agnostic and testable
   with a fake.
3. **Domain:** add `BrowserPaneScreenshot` and hold the latest generation-scoped capture on
   `BrowserPane` next to `page_snapshot` / `page_map`.
4. **Gateway:** extend `browser-observe` to accept `mode` and, when it includes screenshot,
   include the `BrowserPaneScreenshot` in the observe result (authorized + bounded).
5. **MCP bridge (`cli_adapter/mcp.rs`):** when an observe result carries a screenshot, emit
   an MCP **image** content block (`{ type: "image", data: <base64>, mimeType }`) in
   addition to the text block — today `tools/call` only emits a single text block.

## Bounded Contexts

- **pane** (`domain/pane/browser.rs`) — `BrowserPane`, new `BrowserPaneScreenshot`.
- **gateway / cli** (`adapter/inward/cli_adapter/`) — `browser-observe` command + `mode`
  parsing; MCP `tools/call` image content block.
- **platform** (`adapter/outward/platform_adapter/macos/webview.rs`) — WKWebView snapshot.
- **ports** (`application/ports/outward/`) — a browser-snapshot capture port.

## Use Cases

### UC-1: Agent observes the Browser Pane as pixels

- **Actor:** Wrapped Agent (authorized Caller Pane).
- **Trigger:** `tide_browser_observe` with `mode = "screenshot"` or `"both"`.
- **Precondition:** the target Browser Pane exists and the caller is authorized (UC-3).
- **Flow:** Gateway requests a capture through the snapshot port → adapter takes a
  WKWebView snapshot of the visible page → result carries a `BrowserPaneScreenshot` → the
  MCP bridge emits an image content block (plus the text block for `both`).
- **Postcondition:** the agent receives the rendered page as an image.
- **Business Rules:**
  - **BR-1:** `mode` defaults to `text`; `text` returns no screenshot (back-compat, token
    cost). Only `screenshot`/`both` capture an image.
  - **BR-2:** a `BrowserPaneScreenshot` carries PNG bytes, pixel `width`/`height`, and
    `device_scale`.
  - **BR-3:** `both` returns the existing BrowserSnapshot / Browser Page Map **and** the
    screenshot; `screenshot` returns the image without the full BrowserSnapshot body.

### UC-2: Pixel space matches the action / cursor space

- **Actor:** Wrapped Agent.
- **Trigger:** the agent picks a coordinate from the screenshot and calls
  `tide_browser_action` (`click`/`move`/`type` at `x,y`).
- **Precondition:** a screenshot was returned for the same Browser Pane Generation.
- **Flow:** the agent aims using screenshot pixels → the action targets the same viewport
  coordinate space the Browser Automation Cursor already uses.
- **Postcondition:** "see → aim → act" closes with no separate translation step.
- **Business Rules:**
  - **BR-4:** the screenshot is captured in the Browser Pane **viewport** coordinate space
    used by Browser Automation Cursor / coordinate actions; `device_scale` reports the
    pixel-to-point ratio so the agent never faces device-vs-CSS ambiguity.
  - **BR-5:** the screenshot is stamped with the capturing Browser Pane **Generation** so a
    stale capture is distinguishable from the current page.

### UC-3: Capture is authorized, bounded, and focus-safe

- **Actor:** Wrapped Agent / ordinary Gateway caller.
- **Trigger:** any screenshot observe.
- **Flow:** authorization is checked exactly as for other browser observe/snapshot tools;
  capture does not move focus or visibility.
- **Business Rules:**
  - **BR-6:** screenshot capture requires the same Caller Pane / Associated Terminal
    authorization as `tide_browser_observe` (`ensure_snapshot_tool_authorized`); an
    unauthorized caller is rejected with a structured error and no capture.
  - **BR-7:** capturing a Browser Pane never changes Tide focus, the active Stage Terminal,
    or Pane visibility (mirrors the v2 "driving never changes focus" rule).
  - **BR-8:** image dimensions are bounded (normalized toward ~1024 px wide, no 2× device
    pixels) to cap per-observe token cost.

### UC-4: Background Browser Panes are capturable

- **Actor:** Wrapped Agent in a non-focused Terminal.
- **Trigger:** screenshot observe of a Browser Pane that is not the foreground pane.
- **Business Rules:**
  - **BR-9:** a background (offscreen) Browser Pane can be captured, preserving v1's
    existing background-driving capability; if the platform cannot capture an offscreen
    pane, the result falls back to text observe rather than failing (hybrid degrade).

## Invariants

- Default observe is text-only; a screenshot is produced only for explicit
  `mode = screenshot|both` (back-compat + bounded token cost).
- Screenshot pixel space == Browser Automation Cursor / coordinate-action viewport space,
  with `device_scale` reported (BR-4).
- Screenshot capture has no focus/visibility side effects (BR-7).
- Screenshot authorization == existing browser observe authorization (BR-6).
- A `BrowserPaneScreenshot` is Generation-stamped (BR-5).

## Tests

Behavior tests in `crates/tide-app/src/application/behavior_tests/` (fake snapshot port;
no real WKWebView). UC ↔ BR ↔ test mapping:

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1 | `browser_observe_text_mode_returns_no_screenshot` |
| UC-1 | BR-1 | `browser_observe_screenshot_mode_captures_image` |
| UC-1 | BR-2 | `browser_pane_screenshot_carries_png_bytes_size_and_device_scale` |
| UC-1 | BR-3 | `browser_observe_both_returns_page_map_and_screenshot` |
| UC-1 | BR-3 | `mcp_browser_observe_screenshot_emits_image_content_block` |
| UC-2 | BR-4 | `browser_pane_screenshot_uses_viewport_coordinate_space` |
| UC-2 | BR-5 | `browser_pane_screenshot_is_stamped_with_pane_generation` |
| UC-3 | BR-6 | `browser_observe_screenshot_requires_browser_tool_authorization` |
| UC-3 | BR-7 | `capturing_browser_screenshot_does_not_change_focus_or_visibility` |
| UC-3 | BR-8 | `browser_pane_screenshot_dimensions_are_bounded` |
| UC-4 | BR-9 | `background_browser_pane_screenshot_falls_back_to_text_when_uncapturable` |

## Location

- `domain/pane/browser.rs` — `BrowserPaneScreenshot`, `BrowserPane` capture field +
  Generation stamping; `domain/pane/browser_bridge.rs` if any bridge wiring is needed.
- `application/ports/outward/` — browser-snapshot capture port (trait + fake for tests).
- `application/services/` — `browser-observe` `mode` handling that requests a capture.
- `adapter/inward/cli_adapter/commands.rs` — `browser-observe` `mode` parse + result;
  `adapter/inward/cli_adapter/mcp.rs` — image content block on `tools/call`.
- `adapter/outward/platform_adapter/macos/webview.rs` — WKWebView snapshot capability.
