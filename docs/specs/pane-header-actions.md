# Spec: Pane Header Actions

## Overview

### As-Is

`HeaderHitAction` in [crates/tide-app/src/adapter/outward/view/header.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/view/header.rs) currently covers close, git badges, comment, diff, live-preview, and tab switching, but it does not expose a stable icon-only `HeaderActionStrip` for `SplitLayout` creation or direct `Browser Pane` creation from header chrome. `check_header_click()` in [crates/tide-app/src/adapter/inward/click_adapter/header.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/inward/click_adapter/header.rs) therefore cannot create those outcomes from a focused header click today.

Core pane-creation flows still depend on keyboard-only `GlobalAction`s:

1. `GlobalAction::SplitHorizontal`, `SplitVertical`, `DockSplitHorizontal`, and `DockSplitVertical` are wired in [crates/tide-app/src/application/services/action_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/action_service/mod.rs).
2. `GlobalAction::NewTab`, `NewFile`, and `OpenBrowser` are listed in [crates/tide-app/src/domain/input/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/input/mod.rs) and dispatched in the same action service.
3. The Launcher Pane rendered in [crates/tide-app/src/adapter/outward/view/grid.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/view/grid.rs) shows `Terminal`, `New File`, `Open File`, and `Browser`, but [docs/specs/launcher.md](/Users/eatnug/Workspace/tide/docs/specs/launcher.md) and [crates/tide-app/src/application/behavior_tests/launcher_behavior.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/behavior_tests/launcher_behavior.rs) only specify keyboard or IME resolution, not header-driven creation.
4. The titlebar already exposes mouse buttons for `Workspace`, `FileTree`, `Dock`, theme, settings, and integration in [crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs), so the missing keyboardless surface is specifically per-`Pane` and per-`TabGroup` creation.

### To-Be

Stage and Dock headers gain a right-aligned icon-only header action strip built from `HeaderHitAction`. The strip exposes the highest-frequency context actions directly in the active header or active `TabGroup` chrome:

1. `OpenBrowser`
2. `SplitHorizontal`
3. `SplitVertical`

The strip appears on every visible single-`Pane` header and on every visible `TabGroup` header surface, including stacked Stage and stacked Dock tab bars. The controls render as compact glyph-first ghost actions instead of text badges so the single-header and `TabGroup` surfaces share the same visual language without reading as outlined utility tiles. The strip is anchored to the far-right edge of the whole header bar rather than appended inside the active tab capsule.

The current glyph language also becomes more legible at a glance:

1. The Browser glyph reuses the same browser-family icon language already rendered in the Launcher Pane instead of a hand-drawn frame in header chrome.
2. The split glyphs use a matched horizontal-versus-vertical axis-arrow pair rather than framed rectangles or resize bars, so left-right and top-bottom split actions read like the same control family with only the axis changed.
3. The tile chrome stays soft and borderless in steady state; the icon remains the focus instead of a persistent outlined button frame.

The click behavior is contextual:

1. `OpenBrowser` preserves the current terminal-context routing of Tide. When a live context terminal exists, the new non-`Terminal` `Pane` continues to open in the Dock even if the click originated from a focused Stage header.
2. Split actions preserve the current Stage versus Dock routing of the existing creation services.
3. Dock split actions may still use the existing Launcher-based creation path internally, but the header click must resolve that intermediate `Launcher` to a concrete `Terminal` in the same click path so the user does not need a follow-up keyboard shortcut.
4. The new strip reserves width before title and tab elision so the action zones do not overlap titles, badges, or tab-hit regions.
5. On a single-`Pane` header, the strip lives in the right-edge control area of the whole header bar instead of expanding the compact active-tab capsule.
6. On a `TabGroup` header, the strip remains visible even when that `TabGroup` is not focused.
7. On a single-`Pane` header, the strip remains visible even when that `Pane` is not focused.
8. `NewTerminal` and `NewFile` remain available through existing keyboard and `Launcher` flows, but they are no longer exposed in `HeaderActionStrip`.
9. The Browser glyph stays monochrome, but it must reuse Tide's existing browser icon language instead of a custom-framed rectangle.
10. Split glyphs stay monochrome, but they must use a matched axis-specific arrow pair instead of framed rectangle icons or resize-bar glyphs, with horizontal and vertical variants sharing the same visual language.
11. Header action tiles must not render a persistent outline stroke in steady state; they use soft ghost chrome behind the glyph instead.

### Approach

1. Extend `HeaderHitAction` with focused-header creation and split actions.
2. Add a shared header-action-strip helper in `header.rs` so single headers, Stage `TabGroup` headers, Dock `TabGroup` headers, and stacked tab bars all use the same action list and width reservation rules, independent of focus state.
3. Route header clicks through the existing port boundary in `check_header_click()`, using existing `GlobalAction` and `PaneLifecyclePort` methods where possible.
4. For Dock split actions, reuse the current Dock Launcher flow but immediately call `resolve_launcher(..., LauncherChoice::Terminal)` on the newly focused `Launcher`, so the outcome is a concrete `Terminal`.
5. Add behavior tests for the click outcomes before implementation, and add unit tests in `header.rs` for `TabGroup` visibility, action ordering, and width reservation helpers.
6. Extract icon and tile-style helpers in `header.rs` so the Browser and split glyph choices stay testable without screenshot-only verification.
7. Replace the current hand-drawn Browser and split geometry with glyph-based header actions rendered through the existing chrome text pipeline.

## Bounded Contexts

| Module | Path | Role |
|--------|------|------|
| view header | `crates/tide-app/src/adapter/outward/view/header.rs` | Defines `HeaderHitAction`, header action-strip layout, and hit zones |
| chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` | Chooses which header surface renders the action strip |
| click adapter | `crates/tide-app/src/adapter/inward/click_adapter/header.rs` | Dispatches header action clicks through inward ports |
| action service | `crates/tide-app/src/application/services/action_service/mod.rs` | Provides the existing `GlobalAction` entry points for create and split flows |
| pane creation service | `crates/tide-app/src/application/services/pane_create_service/mod.rs` | Owns `new_terminal_tab`, `new_editor_pane`, `open_browser_pane`, `split_with_launcher`, and `resolve_launcher` |

## Use Cases

### UC-1: TriggerHeaderBrowserAction

- **Actor**: User
- **Trigger**: User clicks the visible browser action in Stage or Dock chrome
- **Precondition**: The clicked header belongs to a visible Stage `Pane`, visible Dock `Pane`, or visible `TabGroup`
- **Flow**:
  1. Tide hit-tests a `HeaderHitAction` from the action strip.
  2. Tide dispatches the click through `check_header_click()`.
  3. Tide creates a new `Browser Pane` using the same routing rules as the existing keyboard-triggered creation flow for that focused context.
  4. Tide focuses the created `Pane` and invalidates chrome/layout as needed.
- **Postcondition**: The requested `Browser Pane` exists in the clicked header context without requiring a keyboard shortcut.
- **Business Rules**:
  - BR-1: Any visible single-`Pane` header and any visible `TabGroup` header expose icon-only `HeaderHitAction` entries for `OpenBrowser`, `SplitHorizontal`, and `SplitVertical`, and omit `NewTerminal` and `NewFile`.
  - BR-2: Clicking `OpenBrowser` from a visible header creates a `Browser Pane` using Tide's existing terminal-context routing and focuses it.

### UC-2: TriggerHeaderSplitActions

- **Actor**: User
- **Trigger**: User clicks a visible split action in Stage or Dock chrome
- **Precondition**: The clicked header belongs to a visible Stage or Dock `Pane`
- **Flow**:
  1. Tide hit-tests `HeaderHitAction::SplitHorizontal` or `HeaderHitAction::SplitVertical`.
  2. Tide dispatches the click through `check_header_click()`.
  3. Stage headers use the existing Stage split flow; Dock headers use the existing Dock split flow.
  4. If the Dock split flow creates a `Launcher`, Tide resolves it immediately to a `Terminal`.
  5. Tide focuses the new split result and recomputes layout.
- **Postcondition**: A new split appears in the clicked context without a keyboard shortcut.
- **Business Rules**:
  - BR-3: Clicking `SplitHorizontal` from a focused Stage header creates a new Stage split that divides width and focuses the new `Terminal`.
  - BR-4: Clicking `SplitVertical` from a focused Stage header creates a new Stage split that divides height and focuses the new `Terminal`.
  - BR-5: Clicking a split action from a focused Dock header keeps the new split inside the current Dock layout and resolves any intermediate `Launcher` to a concrete `Terminal`.

### UC-3: ReserveHeaderActionWidth

- **Actor**: System
- **Trigger**: Tide renders a visible single-`Pane` header or visible `TabGroup` header
- **Precondition**: The target header is visible and wide enough to render header chrome
- **Flow**:
  1. Tide computes the header action list for the current header surface.
  2. Tide reserves right-edge width for the action strip before tab and title layout.
  3. Tide elides title or tab content only within the remaining width budget.
  4. Tide keeps the strip visible on every visible header surface.
- **Postcondition**: The action strip stays clickable without overlapping existing title, badge, close, or tab-hit zones.
- **Business Rules**:
  - BR-6: Visible single-`Pane` headers and visible `TabGroup` headers reserve right-edge width for the header action strip before title or tab elision.
  - BR-7: Visible single-`Pane` headers anchor the header action strip to the far-right edge of the whole header bar instead of the compact active-tab capsule.
  - BR-8: Unfocused single-`Pane` headers still render the header action strip.
  - BR-9: Unfocused `TabGroup` headers still render the header action strip.

### UC-4: ClarifyHeaderActionIcons

- **Actor**: User
- **Trigger**: Tide renders Browser and split actions in the visible `HeaderActionStrip`
- **Precondition**: A visible single-`Pane` header or `TabGroup` header includes the action strip
- **Flow**:
  1. Tide computes Browser and split icon glyphs plus tile chrome from shared helpers.
  2. Tide renders those glyphs inside the standard 18x18 header-action tiles.
  3. The user distinguishes Browser and split actions without relying on hover or tooltip text.
- **Postcondition**: Header action icons feel deliberate and legible rather than generic utility glyphs.
- **Business Rules**:
  - BR-10: The Browser glyph must reuse Tide's existing browser glyph language so the header action reads like the Launcher Browser action instead of a custom box drawing.
  - BR-11: Split glyphs must use a matched horizontal-versus-vertical axis-arrow pair for left-right and top-bottom split actions instead of framed rectangle icons or resize-bar glyphs.
  - BR-12: Header action tiles must render as ghost chrome without a persistent outline stroke so the icons do not read like boxed utility buttons.

## Invariants

1. `HeaderHitAction` remains the single click contract for header chrome; no inward adapter directly mutates layout from raw coordinates.
2. Stage header actions mutate the Stage `SplitLayout`; Dock header actions mutate the current Dock layout only.
3. `PaneId` sync between layout state and `App.panes` remains valid after every header action.
4. Focus after a header action always lands on a valid `Pane` in the same context as the clicked header.
5. Header action-strip width reservation must not overlap existing close-button or tab-switch hit zones.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1 | `pane_and_tab_group_header_action_specs_share_browser_and_split_icons` |
| UC-1 | BR-2 | `clicking_open_browser_header_action_creates_a_browser_pane` |
| UC-2 | BR-3 | `clicking_stage_split_horizontal_header_action_creates_a_width_split` |
| UC-2 | BR-4 | `clicking_stage_split_vertical_header_action_creates_a_height_split` |
| UC-2 | BR-5 | `clicking_dock_split_header_action_creates_a_terminal_in_the_dock` |
| UC-3 | BR-6 | `focused_header_action_strip_reserves_right_controls_width` |
| UC-3 | BR-7 | `header_action_strip_start_x_anchors_to_the_header_edge` |
| UC-3 | BR-8 | `single_pane_header_action_specs_remain_visible_without_focus` |
| UC-3 | BR-9 | `unfocused_tab_group_header_action_specs_remain_visible` |
| UC-4 | BR-10 | `browser_header_action_reuses_launcher_browser_glyph` |
| UC-4 | BR-11 | `split_header_action_glyphs_use_a_matched_horizontal_vertical_axis_arrow_pair` |
| UC-4 | BR-12 | `header_action_tile_style_uses_ghost_chrome_without_outline` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Spec | `docs/specs/` | `pane-header-actions.md` |
| View | `crates/tide-app/src/adapter/outward/view/` | `header.rs`, `chrome/tab_bar.rs`, `hover.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/` | `click_adapter/header.rs`, `click_adapter/hit_test.rs` |
| Services | `crates/tide-app/src/application/services/` | `action_service/mod.rs`, `pane_create_service/mod.rs` |
| Behavior Tests | `crates/tide-app/src/application/behavior_tests/` | `pane_header_actions.rs` |
