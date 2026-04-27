# Spec: Stage Split-Only

## Overview

### As-Is

Before this change, Stage still had product paths that created and rendered ordinary `TabGroup` nodes even though `docs/specs/layout-v2.md` says Stage uses `SplitLayout` with single-`PaneId` leaves and `TabGroup` is for Dock. The removed paths were:

1. `new_terminal_tab()` adds a Stage `Terminal` with `layout.add_tab(focused, new_id)`.
2. Stage `DropZone::Center` in `click_adapter/pane.rs` removes the source pane and calls `layout_add_tab(target_id, source)`.
3. `render_pane_chrome()` collects Stage LeafGroups and renders `render_stage_tab_group_bar()` in split mode.
4. `cycle_tab()` cycles within the current Stage `TabGroup`.
5. Legacy Stage `LeafGroup` snapshots can keep hidden Stage panes in the layout tree.

### To-Be

Stage is split-only in normal use. A Stage `Pane` may be moved or created only as a visible split leaf. The only tab-like Stage presentation is `ViewMode::Stacked`, which shows one focused Stage `Pane` full-size and a flat tab bar over the Stage split panes.

Dock uses Terminal Context Surface split/stack behavior. This spec only removes ordinary Stage `TabGroup` product behavior; Dock split/stack behavior is covered by `docs/specs/open-terminal-codex-app.md` and `docs/specs/dock-global.md`.

### Approach

1. Replace Stage `TabGroup` creation paths with split insertion.
2. Treat Stage `DropZone::Center` as a Pane swap, not a tab merge.
3. Stop rendering per-`TabGroup` Stage tab bars in split mode.
4. Make `TabPrev` and `TabNext` no-op in Stage split mode.
5. Keep `TabPrev`, `TabNext`, click switching, and scroll behavior for Stage `ViewMode::Stacked`.
6. Expand any legacy Stage `LeafGroup` nodes into visible split leaves during layout computation so old persisted layouts do not hide panes.

## Bounded Contexts

| Module | Path | Changes |
|--------|------|---------|
| layout | `domain/layout/` | Add a normalization helper that expands legacy `LeafGroup` nodes into split leaves for Stage and Terminal Context Surface Split view. |
| pane lifecycle | `application/services/pane_create_service/` | Create Stage panes as split leaves instead of tabs. |
| workspace navigation | `application/services/workspace_service/` | Make Stage tab cycling apply only to `ViewMode::Stacked`. |
| click adapter | `adapter/inward/click_adapter/pane.rs` | Make Stage center drops swap Pane positions; keep directional drops as splits. |
| drag-drop adapter | `adapter/inward/drag_drop_adapter/` | Expose Stage center drops only as swap targets and do not expose Stage self-drop extraction targets. |
| view | `adapter/outward/view/chrome/tab_bar.rs` | Render only normal Pane headers in Stage split mode and the flat Stage tab bar in `ViewMode::Stacked`. |

## Use Cases

### UC-1: CreateStagePaneAsSplit

**Actor**: User
**Trigger**: User invokes `NewTab`, `NewFile`, Browser Pane creation, Render Pane creation, or a Stage split action while Stage is focused.
**Precondition**: A Stage `Pane` is focused.

**Flow**:
1. Tide allocates a new `PaneId`.
2. Tide inserts the new `Pane` into Stage as a `SplitLayout` leaf next to the focused Stage `Pane`.
3. Tide focuses the new `Pane`.
4. If `ViewMode::Stacked` is active, Tide keeps stacked mode and makes the new `Pane` the zoomed pane.

**Postcondition**: The new Stage `Pane` is visible through a split leaf or selected in stacked mode. No ordinary Stage `TabGroup` is created.

**Business Rules**:
- BR-1: `NewTab` in Stage creates a `Terminal` split leaf, not a Stage `TabGroup` tab.
- BR-2: `NewFile`, Browser Pane, and Render Pane fallbacks in Stage create split leaves, not Stage `TabGroup` tabs.
- BR-3: A Stage split performed while `ViewMode::Stacked` is active preserves `ViewMode::Stacked` and focuses the new Stage `Pane`.
- BR-4: Creating a new `Workspace` starts Stage in `ViewMode::Split` with no `zoomed_pane`, even if the previous `Workspace` was Stacked.

### UC-2: MoveStagePaneBySplitOnly

**Actor**: User
**Trigger**: User drags a Stage `Pane`.
**Precondition**: Source and target are Stage `Pane`s.

**Flow**:
1. Tide computes a directional drop target when the pointer is near a target edge.
2. On release, Tide removes the source from its old split position.
3. Tide inserts the source as a split leaf next to the target.
4. If the pointer is in the target center zone, Tide swaps the source and target Pane positions.

**Postcondition**: Stage layout remains split-only.

**Business Rules**:
- BR-1: Stage `DropZone::Center` swaps the source and target Pane positions.
- BR-2: Stage directional drops insert split leaves.
- BR-3: Stage self-drop extraction targets are not offered because there are no ordinary Stage `TabGroup`s to extract from.
- BR-4: Stage-to-Dock and Dock-to-Stage drops remain blocked.
- BR-5: Stage center hit testing returns a swap drop target so the rendered drop hint matches the release action.

### UC-3: CycleStageOnlyWhenStacked

**Actor**: User
**Trigger**: User presses `TabPrev` or `TabNext`.
**Precondition**: FocusArea is Stage.

**Flow**:
1. If `ViewMode::Split` is active, Tide does nothing.
2. If `ViewMode::Stacked` is active, Tide cycles through Stage split panes in traversal order.
3. Tide updates focus and `focus.zoomed_pane` to the selected Stage `Pane`.

**Postcondition**: Tab cycling is only a stacked-mode operation in Stage.

**Business Rules**:
- BR-1: `TabPrev` and `TabNext` are no-ops in Stage split mode.
- BR-2: `TabPrev` and `TabNext` cycle Stage split panes in `ViewMode::Stacked`.
- BR-3: Cycling in `ViewMode::Stacked` wraps at both ends.
- BR-4: Dock tab cycling still targets the Terminal Context Surface.

### UC-4: RenderStageWithoutOrdinaryTabGroupChrome

**Actor**: System
**Trigger**: Layout recomputation or chrome rendering.
**Precondition**: Stage has one or more visible split panes.

**Flow**:
1. In `ViewMode::Split`, Tide renders normal Pane headers for Stage panes.
2. Tide does not render per-`TabGroup` Stage tab bars.
3. In `ViewMode::Stacked`, Tide renders the flat Stage tab bar over all Stage split panes.

**Postcondition**: Stage split mode reads as panes and splits, not as tab groups.

**Business Rules**:
- BR-1: Stage split mode must not render a per-`TabGroup` tab bar.
- BR-2: Stage `ViewMode::Stacked` keeps the flat tab bar.
- BR-3: Stage tab-scroll state applies only to the flat stacked-mode tab bar.

### UC-5: NormalizeLegacyStageLeafGroups

**Actor**: System
**Trigger**: Layout computation after loading or mutating a Stage layout.
**Precondition**: The Stage `SplitLayout` contains a legacy `LeafGroup`.

**Flow**:
1. Tide reads the legacy `LeafGroup` tabs in stored order.
2. Tide replaces the `LeafGroup` with a chain of split leaves.
3. Tide recomputes layout rectangles for all formerly hidden panes.

**Postcondition**: All Stage panes are visible split leaves and `PaneId` sync is preserved.

**Business Rules**:
- BR-1: A legacy Stage `LeafGroup` with multiple tabs expands into visible split leaves.
- BR-2: A legacy Stage `LeafGroup` with one tab collapses to one split leaf.
- BR-3: Terminal Context Surface normalization is governed by the Dock split/stack specs, not this Stage-only rule.

## Invariants

1. **PaneId sync**: Every Stage `PaneId` in `SplitLayout` exists in `App.panes`, and every Stage `Pane` in `App.panes` is represented by a Stage split leaf.
2. **Stage split-only**: Ordinary Stage use must not create `LeafGroup(TabGroup)` nodes.
3. **Dock boundary**: Terminal Context Surface split/stack behavior is separate from Stage split-only behavior.
4. **ViewMode boundary**: Stage tab-like UI is only allowed in `ViewMode::Stacked`.

## Tests

| UC | BR | Test Function |
|----|----|---------------|
| UC-1 | BR-1 | `new_terminal_tab_creates_stage_split_not_tab_group()` |
| UC-1 | BR-2 | `new_editor_pane_creates_stage_split_not_tab_group()` |
| UC-1 | BR-3 | `splitting_stacked_stage_keeps_stacked_mode_and_creates_split()` |
| UC-1 | BR-4 | `new_workspace_defaults_stage_to_split_mode()` |
| UC-2 | BR-1 | `center_drop_on_stage_pane_swaps_positions()` |
| UC-2 | BR-5 | `center_drop_on_stage_pane_has_swap_drop_target()` |
| UC-2 | BR-2 | `edge_drop_on_stage_pane_keeps_split_layout()` |
| UC-2 | BR-3 | `stage_self_drop_has_no_drop_target_or_preview()` |
| UC-3 | BR-1 | `tab_prev_next_in_stage_split_mode_is_noop()` |
| UC-3 | BR-2 | `tab_prev_next_in_stacked_stage_cycles_split_panes()` |
| UC-4 | BR-1 | `stage_split_mode_has_no_shared_tab_scroll()` |
| UC-4 | BR-2 | `stacked_stage_tab_bar_uses_split_panes()` |
| UC-5 | BR-1 | `legacy_stage_leaf_group_expands_to_splits_on_layout_compute()` |

## Location

| Item | Path |
|------|------|
| Spec | `docs/specs/stage-split-only.md` |
| SplitLayout | `crates/tide-app/src/domain/layout/` |
| Pane lifecycle | `crates/tide-app/src/application/services/pane_create_service/mod.rs` |
| Workspace navigation | `crates/tide-app/src/application/services/workspace_service/mod.rs` |
| Drop handling | `crates/tide-app/src/adapter/inward/click_adapter/pane.rs` |
| Drop target and preview | `crates/tide-app/src/adapter/inward/drag_drop_adapter/mod.rs` |
| Chrome rendering | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/stage_split_only.rs` |
