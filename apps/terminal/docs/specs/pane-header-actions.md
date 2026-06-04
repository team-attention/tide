# Spec: Pane Header Actions

## Overview

### As-Is

`HeaderHitAction` in [crates/tide-app/src/adapter/outward/view/header.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/view/header.rs) covers close, git badges, comment, diff, live-preview, tab switching, `OpenBrowser`, `AddPane`, and split actions. The repeated `OpenBrowser` action in visible `HeaderActionStrip` chrome is too specific for a compact per-`Pane` control because it opens a Browser Pane directly instead of letting the user choose from a Launcher Pane.

Core pane-creation flows still depend on keyboard-only `GlobalAction`s:

1. `GlobalAction::SplitHorizontal`, `SplitVertical`, `DockSplitHorizontal`, and `DockSplitVertical` are wired in [crates/tide-app/src/application/services/action_service/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/application/services/action_service/mod.rs).
2. `GlobalAction::NewTab`, `NewFile`, and `OpenBrowser` are listed in [crates/tide-app/src/domain/input/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/domain/input/mod.rs) and dispatched in the same action service.
3. The Launcher Pane rendered in [crates/tide-app/src/adapter/outward/view/grid.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/view/grid.rs) shows `Terminal`, `New File`, `Open File`, and `Browser`, but [docs/specs/launcher.md](/Users/you/Workspace/tide/docs/specs/launcher.md) and [crates/tide-app/src/application/behavior_tests/launcher_behavior.rs](/Users/you/Workspace/tide/crates/tide-app/src/application/behavior_tests/launcher_behavior.rs) only specify keyboard or IME resolution, not header-driven creation.
4. The titlebar already exposes mouse buttons for `Workspace`, `FileTree`, `Dock`, settings, and integration in [crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs](/Users/you/Workspace/tide/crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs). Stage already has a Dock toggle, so repeated Stage add-pane chrome is no longer the primary mouse path for opening Launcher choices.

### To-Be

Stage and Dock headers keep a right-aligned icon-only header action strip built from `HeaderHitAction`. Stage single-`Pane` headers expose split actions only:

1. `SplitHorizontal`
2. `SplitVertical`

Terminal Context Surface single-`Pane` headers expose split actions only:

1. `SplitHorizontal`
2. `SplitVertical`

Stage and Terminal Context Surface stacked tab bars expose one `AddPane` action rendered as `+` instead of split-direction icons. The stacked `AddPane` action internally splits the last `Pane` in that surface's `SplitLayout` with `SplitDirection::Vertical`, so the new `Launcher Pane` appears as the final stacked tab. The controls render as compact glyph-first ghost actions instead of text badges so the single-header and stacked tab-bar surfaces share the same visual language without reading as outlined utility tiles. The strip is anchored to the far-right edge of the whole header bar rather than appended inside the active tab capsule.

The current glyph language also becomes more legible at a glance:

1. The AddPane glyph uses a single plus icon so the action reads as opening a Launcher Pane rather than opening a specific Browser Pane.
2. The split glyphs use a matched horizontal-versus-vertical axis-arrow pair rather than framed rectangles or resize bars, so left-right and top-bottom split actions read like the same control family with only the axis changed.
3. The add-pane glyph uses a single plus icon in stacked tab bars so the action reads as "add another pane to this Stacked view", not "split this surface".
4. The tile chrome stays soft and borderless in steady state; the icon remains the focus instead of a persistent outlined button frame.

The click behavior is contextual:

1. `AddPane` opens a focused Launcher Pane from stacked Stage or Terminal Context Surface chrome only.
2. Stage split actions preserve the current Stage split routing of the existing creation services.
3. Dock split actions use the Terminal Context Surface model: Split view creates a context split with a focused `Launcher Pane`, while Stacked view preserves stacked presentation and uses the stacked `AddPane` action.
4. The new strip reserves width before title and tab elision so the action zones do not overlap titles, badges, or tab-hit regions.
5. On a single-`Pane` header, the strip lives in the right-edge control area of the whole header bar instead of expanding the compact active-tab capsule.
6. On Stage and Terminal Context Surface stacked tab bars, the strip remains visible even when that surface is not focused and uses `AddPane`.
7. On a single-`Pane` header, the strip remains visible even when that `Pane` is not focused.
8. `OpenBrowser` and `NewFile` remain available through existing keyboard and `Launcher` flows, but direct `OpenBrowser` is not repeated in every visible header.
9. The AddPane glyph stays monochrome and uses a plus `HeaderActionIcon`.
10. Split glyphs stay monochrome, but they must use a matched axis-specific arrow pair instead of framed rectangle icons or resize-bar glyphs, with horizontal and vertical variants sharing the same visual language.
11. Header action tiles must not render a persistent outline stroke in steady state; they use soft ghost chrome behind the glyph instead.
12. Clicking `AddPane` creates and focuses a `Launcher Pane`; it must not immediately resolve the `Launcher Pane` to a `Terminal Pane`.

### Approach

1. Extend `HeaderHitAction` with focused-header creation and split actions.
2. Add header-action-strip helpers in `header.rs` so Stage single headers use split actions, Terminal Context Surface single headers use add-pane/split actions, and only Terminal Context Surface stacked tab bars use add-pane actions with the same width reservation rules, independent of focus state.
3. Route header clicks through the existing port boundary in `check_header_click()`, using existing `GlobalAction` and `PaneLifecyclePort` methods where possible.
4. For Dock split actions, focus the clicked Dock Pane and create a new context split in the owning Stage `Terminal`'s Terminal Context Surface.
5. Add behavior tests for the click outcomes before implementation, and add unit tests in `header.rs` for stacked tab-bar visibility, action ordering, and width reservation helpers.
6. Extract icon and tile-style helpers in `header.rs` so the Browser and split glyph choices stay testable without screenshot-only verification.
7. Replace the current hand-drawn Browser and split geometry with glyph-based header actions rendered through the existing chrome text pipeline.

## Bounded Contexts

| Module | Path | Role |
|--------|------|------|
| view header | `crates/tide-app/src/adapter/outward/view/header.rs` | Defines `HeaderHitAction`, header action-strip layout, and hit zones |
| chrome renderer | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` | Chooses which header surface renders the action strip |
| click adapter | `crates/tide-app/src/adapter/inward/click_adapter/header.rs` | Dispatches header action clicks through inward ports |
| action service | `crates/tide-app/src/application/services/action_service/mod.rs` | Provides the existing `GlobalAction` entry points for create and split flows |
| pane creation service | `crates/tide-app/src/application/services/pane_create_service/mod.rs` | Owns `new_terminal_tab`, `open_launcher_pane`, `new_editor_pane`, `open_browser_pane`, `split_with_launcher`, and `resolve_launcher` |

## Use Cases

### UC-1: TriggerHeaderLauncherAction

- **Actor**: User
- **Trigger**: User clicks the visible add-pane action in stacked Stage or Terminal Context Surface chrome
- **Precondition**: The clicked header belongs to a visible Stage stacked tab bar or Terminal Context Surface stacked tab bar
- **Flow**:
  1. Tide hit-tests a `HeaderHitAction` from the action strip.
  2. Tide dispatches the click through `check_header_click()`.
  3. Tide creates a new `Launcher Pane` by vertically splitting the last `Pane` in that surface's `SplitLayout`.
  4. Tide focuses the created `Pane` and invalidates chrome/layout as needed.
- **Postcondition**: The requested `Launcher Pane` exists as the final stacked tab in the clicked header context without requiring a keyboard shortcut.
- **Business Rules**:
  - BR-1: Any visible Stage single-`Pane` header exposes icon-only `HeaderHitAction` entries for `SplitHorizontal` and `SplitVertical`, and omits `AddPane`, `OpenBrowser`, and `NewFile`.
  - BR-1a: Any visible Stage or Terminal Context Surface stacked tab bar exposes `AddPane` and omits `OpenBrowser` and split-direction actions.
  - BR-1b: Any visible Terminal Context Surface single-`Pane` header exposes `SplitHorizontal` and `SplitVertical`, and omits `AddPane`, direct `OpenBrowser`, and `NewFile`.
  - BR-2: Clicking stacked `AddPane` creates a focused `Launcher Pane` instead of an immediate `Terminal Pane`.
  - BR-2a: Clicking stacked `AddPane` vertically splits the last `Pane` in the clicked surface's `SplitLayout`, so the created `Launcher Pane` is the final stacked tab.

### UC-2: TriggerHeaderSplitActions

- **Actor**: User
- **Trigger**: User clicks a visible split action in Stage or Dock chrome
- **Precondition**: The clicked header belongs to a visible Stage or Dock single `Pane`
- **Flow**:
  1. Tide hit-tests `HeaderHitAction::SplitHorizontal` or `HeaderHitAction::SplitVertical`.
  2. Tide dispatches the click through `check_header_click()`.
  3. Stage headers use the existing Stage split flow.
  4. Dock headers use the existing Dock split flow after focusing the clicked Dock Pane.
  5. Tide recomputes layout with the new split in the clicked header's context.
- **Postcondition**: Stage split actions create a new Stage split; Dock split actions create a new Terminal Context Surface split.
- **Business Rules**:
  - BR-3: Clicking `SplitHorizontal` from a focused Stage header creates a new Stage split that divides height and focuses the new `Terminal`.
  - BR-4: Clicking `SplitVertical` from a focused Stage header creates a new Stage split that divides width and focuses the new `Terminal`.
  - BR-5: Clicking a split action from a focused Dock header must create a new context split with a focused `Launcher Pane` in the owning Stage `Terminal`'s Terminal Context Surface.

### UC-3: ReserveHeaderActionWidth

- **Actor**: System
- **Trigger**: Tide renders a visible single-`Pane` header or visible stacked tab bar
- **Precondition**: The target header is visible and wide enough to render header chrome
- **Flow**:
  1. Tide computes the header action list for the current header surface.
  2. Tide reserves right-edge width for the action strip before tab and title layout.
  3. Tide elides title or tab content only within the remaining width budget.
  4. Tide keeps the strip visible on every visible header surface.
- **Postcondition**: The action strip stays clickable without overlapping existing title, badge, close, or tab-hit zones.
- **Business Rules**:
  - BR-6: Visible single-`Pane` headers and Terminal Context Surface stacked tab bars reserve right-edge width for their header action strip before title or tab elision.
  - BR-7: Visible single-`Pane` headers anchor the header action strip to the far-right edge of the whole header bar instead of the compact active-tab capsule.
  - BR-8: Unfocused single-`Pane` headers still render the header action strip.
  - BR-9: Unfocused Terminal Context Surface stacked tab bars still render the header action strip.

### UC-4: ClarifyHeaderActionIcons

- **Actor**: User
- **Trigger**: Tide renders AddPane, split, or add-tab actions in the visible `HeaderActionStrip`
- **Precondition**: A visible single-`Pane` header or stacked tab bar includes the action strip
- **Flow**:
  1. Tide computes AddPane, split, and add-tab vector icon roles plus tile chrome from shared helpers.
  2. Tide renders those vector icons inside the standard 18x18 header-action tiles.
  3. The user distinguishes add-pane and split actions without relying on hover or tooltip text.
- **Postcondition**: Header action icons feel deliberate and legible rather than generic utility glyphs.
- **Business Rules**:
  - BR-10: The AddPane action must use a plus `HeaderActionIcon` role instead of a brand-specific or font-dependent glyph.
  - BR-11: Split actions must use matched rows-versus-columns `HeaderActionIcon` roles so left-right and top-bottom splits read as one family.
  - BR-12: Header action tiles must render as ghost chrome without a persistent outline stroke so the icons do not read like boxed utility buttons.
  - BR-13: The `AddPane` action must render as a plus `HeaderActionIcon` in stacked tab-bar chrome.

## Invariants

1. `HeaderHitAction` remains the single click contract for header chrome; no inward adapter directly mutates layout from raw coordinates.
2. Stage header split actions mutate the Stage `SplitLayout`; Dock header split actions mutate the owning Stage `Terminal`'s Terminal Context Surface `SplitLayout`.
3. `PaneId` sync between layout state and `App.panes` remains valid after every header action.
4. Focus after a header action always lands on a valid `Pane` in the same context as the clicked header.
5. Header action-strip width reservation must not overlap existing close-button or tab-switch hit zones.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1 | `stage_single_pane_header_action_specs_omit_add_pane` |
| UC-1 | BR-1a | `stage_stacked_tab_bar_header_action_specs_use_add_pane` |
| UC-1 | BR-1b | `terminal_context_single_pane_header_action_specs_use_split_icons_without_add_pane` |
| UC-1 | BR-2 | `clicking_dock_add_pane_header_action_creates_launcher_pane` |
| UC-1 | BR-2a | `clicking_stage_stacked_add_pane_splits_the_last_stage_pane_vertically` |
| UC-1 | BR-2a | `clicking_dock_stacked_add_pane_splits_the_last_context_pane_vertically` |
| UC-2 | BR-3 | `clicking_stage_split_horizontal_header_action_creates_a_height_split` |
| UC-2 | BR-4 | `clicking_stage_split_vertical_header_action_creates_a_width_split` |
| UC-2 | BR-5 | `clicking_dock_split_header_action_creates_context_split` |
| UC-3 | BR-6 | `focused_header_action_strip_reserves_right_controls_width` |
| UC-3 | BR-7 | `header_action_strip_start_x_anchors_to_the_header_edge` |
| UC-3 | BR-9 | `unfocused_stacked_tab_bar_header_action_specs_remain_visible` |
| UC-4 | BR-10 | `add_pane_header_action_uses_plus_icon_role` |
| UC-4 | BR-11 | `split_header_action_icons_use_rows_and_columns_roles` |
| UC-4 | BR-12 | `header_action_tile_style_uses_ghost_chrome_without_outline` |
| UC-4 | BR-13 | `add_pane_header_action_uses_plus_icon_role` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Spec | `docs/specs/` | `pane-header-actions.md` |
| View | `crates/tide-app/src/adapter/outward/view/` | `header.rs`, `chrome/tab_bar.rs`, `hover.rs` |
| Inward Adapter | `crates/tide-app/src/adapter/inward/` | `click_adapter/header.rs`, `click_adapter/hit_test.rs` |
| Services | `crates/tide-app/src/application/services/` | `action_service/mod.rs`, `pane_create_service/mod.rs` |
| Behavior Tests | `crates/tide-app/src/application/behavior_tests/` | `pane_header_actions.rs` |
