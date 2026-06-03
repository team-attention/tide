# Spec: Terminal Context Surface Compatibility

## Overview

### As-Is

`docs/specs/open-terminal-codex-app.md` defines the product direction for the right region: the active Stage `Terminal` owns one Terminal Context Surface. Split view allows context splits, Stacked view shows one active context Pane with a flat tab bar, and pinned groups remain legacy-only state that cannot become a drop target.

The older Dock model still exists in code:

1. `DockState` still stores `pinned_dock_layout`, `pinned_dock_ratio`, and `pinned_border_dragging` for backward-compatible cold storage.
2. `ToggleDockPin` can still be invoked by old keybindings.
3. `layout_compute.rs`, `tab_bar.rs`, `workspace_service`, and click/drag adapters must ignore legacy pinned state and use only the owning Stage `Terminal`'s Terminal Context Surface.

Those older paths conflict with the Terminal Context Surface model when they create a second global right-region hierarchy that is not owned by the focused Stage `Terminal`.

### To-Be

The only remaining global Dock behavior is width compatibility: `dock_width` stays global across Stage `Terminal` focus changes.

Terminal Context Surface behavior is split/stack, matching Stage:

1. `ToggleDockPin` is a no-op for user-visible state.
2. Legacy pinned layout fields may remain in state, but they must not render, receive drops, affect placeholders, or participate in tab navigation.
3. Dock Stacked view renders one active context Pane and a flat tab bar over all context Panes.
4. Dock Split view renders the owning Stage `Terminal`'s context `SplitLayout`; directional drops and split actions split that layout.
5. Dock center drops swap context Panes instead of creating a legacy shared `TabGroup`.
6. Each newly created Stage `Terminal` starts its Terminal Context Surface in Stacked view, while an existing Stage `Terminal` keeps its own Dock Split/Stacked choice.

### Approach

1. Keep `dock_width` global and preserve the existing width behavior tests.
2. Treat pinned Dock state as legacy internal state that is not reachable through user actions.
3. Remove pinned layout from layout computation, tab-bar composition, placeholder logic, drag-preview routing, and Dock tab cycling.
4. Route Dock split, center drop, and stacked commands to the owning Terminal Context Surface while keeping pinned Dock commands as compatibility no-ops.
5. Keep `PaneId` sync by never moving a live Pane into `pinned_dock_layout` in V1.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/state/dock.rs` | Retains legacy Dock fields while user-visible behavior ignores pinned Dock state. |
| `application/services/dock_service/` | Owns global context width, Dock visibility, context Pane insertion, split mutation, stacked state, and pin no-op compatibility. |
| `application/services/workspace_service/` | Keeps Dock navigation and tab cycling scoped to the focused Stage `Terminal`'s Terminal Context Surface. |
| `domain/layout/` | Provides `SplitLayout` operations for split-first Terminal Context Surface behavior. |
| `layout_compute.rs` | Computes Stage plus the focused Stage `Terminal`'s Terminal Context Surface in Split or Stacked view. |
| `adapter/inward/click_adapter/` | Routes Dock center drops to swap and directional drops to context splits. |
| `adapter/inward/drag_drop_adapter/` | Advertises only normal Stage, Dock, and Workspace drop destinations. |
| `adapter/outward/view/chrome/tab_bar.rs` | Renders no pinned separator and renders Dock stacked tab chrome only when Dock is stacked. |

## Use Cases

### UC-1: GlobalDockWidth

- **Actor**: User
- **Trigger**: User resizes Dock border or switches Stage `Terminal` focus
- **Precondition**: Dock is open
- **Flow**:
  1. User changes `dock_width`.
  2. User focuses another Stage `Terminal`.
  3. Tide keeps the same right-region width.
- **Postcondition**: Terminal Context Surface width is stable across Stage `Terminal` focus changes.
- **Business Rules**:
  - BR-1: Dock width is global state on `DockState`, not per `Terminal`.
  - BR-2: Switching Stage `Terminal`s does not change `dock_width`.
  - BR-3: Split ratios inside Stage `SplitLayout` and Terminal Context Surface continue to be relative layout concerns.

### UC-2: RejectPinnedDock

- **Actor**: User
- **Trigger**: User invokes `ToggleDockPin` or drags a context Pane over the legacy pinned layout area
- **Precondition**: The Pane is in a Terminal Context Surface
- **Flow**:
  1. Tide receives the legacy pin action.
  2. Tide leaves the Pane in the owning Stage `Terminal`'s Terminal Context Surface.
  3. Tide keeps `Associated Terminal`, focus, split order, and stacked tab order intact.
- **Postcondition**: No pinned group exists and no Pane moves into legacy pinned state.
- **Business Rules**:
  - BR-1: `ToggleDockPin` must not move a Pane into `pinned_dock_layout`.
  - BR-2: `is_pane_pinned` and `has_pinned_panes` return false for user-visible behavior.
  - BR-3: Legacy pinned layout must not create a separate Dock drop target.
  - BR-4: Legacy pinned layout contents must not make the Dock visible, suppress placeholders, or render tab chrome.

### UC-3: ToggleDockStacked

- **Actor**: User
- **Trigger**: User invokes `DockToggleStacked` or clicks maximize on a context Pane
- **Precondition**: Dock is open and focus is in `FocusArea::Dock`
- **Flow**:
  1. Tide toggles Dock stacked state.
  2. Tide keeps the owning Terminal's context `SplitLayout` intact.
  3. Tide renders only the active context Pane when stacked and restores split rendering when unstacked.
- **Postcondition**: Terminal Context Surface switches between Split and Stacked presentation without creating a pinned group.
- **Business Rules**:
  - BR-1: Dock stacked state must render exactly one active context Pane.
  - BR-2: `DockToggleStacked` must not flatten the context `SplitLayout`.
  - BR-3: Header maximize on a context Pane must toggle Dock stacked state.
  - BR-4: A newly created Stage `Terminal` defaults its Terminal Context Surface to Stacked view without resetting another Stage `Terminal`'s Dock Split/Stacked choice.
  - BR-5: In stacked Terminal Context Surface, closing the focused context Pane moves focus to the immediately previous Pane in the flat stacked tab order; if there is no previous Pane, focus moves to the immediately next Pane.

### UC-4: RenderTerminalContextOnly

- **Actor**: System
- **Trigger**: Layout recomputation, tab-bar rendering, or drag/drop preview
- **Precondition**: Active Workspace has a focused Stage `Terminal`
- **Flow**:
  1. Tide computes Stage from the Workspace `SplitLayout`.
  2. Tide computes the right region from only the focused Stage `Terminal`'s Terminal Context Surface.
  3. Tide ignores legacy pinned layout fields.
- **Postcondition**: The right region follows the active Stage `Terminal` and contains no global pinned surface.
- **Business Rules**:
  - BR-1: Layout computation must ignore `pinned_dock_layout`.
  - BR-2: Tab-bar rendering must not include pinned tabs or a pinned separator.
  - BR-3: Dock tab navigation must cycle only through the focused Stage `Terminal`'s Terminal Context Surface.
  - BR-4: Drag/drop hit testing and file-open insertion must use Terminal Context Surface destinations; center drops swap, and newly opened files default to right-side context splits.

## Invariants

1. **Global width**: `dock_width` is a shared right-region width.
2. **Context SplitLayout**: Terminal Context Surface uses the owning Terminal's context `SplitLayout` in Split view and keeps that layout intact in Stacked view.
3. **No pinned surface**: No user action creates or renders a pinned Dock group in V1.
4. **Dock split/stack**: Dock Stacked view is presentation-only and preserves the underlying context `SplitLayout`.
5. **PaneId sync**: A live context `PaneId` remains in exactly one owning Stage `Terminal` context `SplitLayout` and in `App.panes`.
6. **Per-Terminal context presentation**: Dock Split/Stacked choice follows the focused Stage `Terminal`, not a global shared context presentation.

## Tests

| UC | BR | Test Function |
|----|----|---------------|
| UC-1 | BR-1 | `dock_width_is_global_not_per_terminal()` |
| UC-1 | BR-2 | `switching_terminals_preserves_dock_width()` |
| UC-2 | BR-1 | `toggle_dock_pin_keeps_pane_in_terminal_context_surface()` |
| UC-2 | BR-2 | `pin_queries_report_no_visible_pinned_panes()` |
| UC-2 | BR-3 | `legacy_pinned_layout_does_not_intercept_context_drop_target()` |
| UC-2 | BR-4 | `legacy_pinned_layout_does_not_keep_dock_open()` |
| UC-3 | BR-1 | `dock_stacked_mode_renders_only_active_context_pane()` |
| UC-3 | BR-2 | `dock_toggle_stacked_preserves_context_split_layout()` |
| UC-3 | BR-3 | `context_pane_maximize_toggles_dock_stacked_mode()` |
| UC-3 | BR-4 | `new_stage_terminal_defaults_terminal_context_surface_to_stacked_mode()` |
| UC-4 | BR-1 | `layout_compute_ignores_legacy_pinned_layout()` |
| UC-4 | BR-2 | `tab_bar_ignores_legacy_pinned_layout()` |
| UC-4 | BR-3 | `dock_tab_cycle_uses_only_active_terminal_context_surface()` |
| UC-4 | BR-4 | `drag_drop_uses_only_context_surface_destinations()` |
| UC-4 | BR-4 | `center_drop_on_context_pane_swaps_without_merging_context_panes()` |
| UC-4 | BR-4 | `opening_file_in_context_surface_defaults_to_right_split()` |

## Location

| Item | Path |
|------|------|
| Compatibility spec | `docs/specs/dock-global.md` |
| Main product spec | `docs/specs/open-terminal-codex-app.md` |
| Dock state | `crates/tide-app/src/domain/state/dock.rs` |
| Dock service | `crates/tide-app/src/application/services/dock_service/` |
| Workspace navigation | `crates/tide-app/src/application/services/workspace_service/` |
| Layout computation | `crates/tide-app/src/layout_compute.rs` |
| Tab-bar rendering | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` |
| Click and drag adapters | `crates/tide-app/src/adapter/inward/click_adapter/`, `crates/tide-app/src/adapter/inward/drag_drop_adapter/` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/dock_global_behavior.rs` |
