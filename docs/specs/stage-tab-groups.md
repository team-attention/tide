# Spec: Stage TabGroups

## Overview

### As-Is

Stage already uses `SplitLayout` `Node::LeafGroup(TabGroup)` nodes. `render_pane_chrome()` renders per-`TabGroup` Stage tab bars through `render_stage_tab_group_bar()`, and `click_adapter/pane.rs` already routes `DropZone::Center` on a Stage target to `layout_add_tab(target_id, source)`.

Key current behaviors:
1. **Stage tab groups already render**: `render_pane_chrome()` checks `stage_tab_groups.contains_key(&id)` and calls `render_stage_tab_group_bar()` for Stage `TabGroup`s in split mode (`crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs`).
2. **Center drop already merges into a Stage `TabGroup`**: dropping onto a Stage `Pane` with `DropZone::Center` removes the source from Stage and calls `layout_add_tab(target_id, source)` (`crates/tide-app/src/adapter/inward/click_adapter/pane.rs`).
3. **Stage tab drag does not start from the tab bar**: `HeaderHitAction::DockTab` switches focus and enters `PaneDragState::PendingDrag`, but `HeaderHitAction::StageTab` only focuses the target `Pane` and invalidates chrome (`crates/tide-app/src/adapter/inward/click_adapter/header.rs`).
4. **Self-extraction is Dock-only today**: `compute_tree_drop_target()` only allows directional self-drop when the source `Pane` is in a Dock `TabGroup` with multiple tabs, so a Stage tab cannot be pulled out into a new split (`crates/tide-app/src/adapter/inward/drag_drop_adapter/mod.rs`).
5. **Cross-area protection is only complete in one direction**: `click_adapter/pane.rs` already rejects Dock-to-Stage drops, but there is no matching Stage-to-Dock rejection before the Stage layout mutation path runs (`crates/tide-app/src/adapter/inward/click_adapter/pane.rs` and `crates/tide-app/src/adapter/inward/drag_drop_adapter/mod.rs`).
6. **Stage close focus still falls back to layout-neighbor logic**: `force_close_editor_panel_tab()` currently asks `right_neighbor_pane()` for the next focus target before removal, which ignores `TabGroup` adjacency and can skip the remaining active tab contract that `TabGroup::remove_tab()` already defines (`crates/tide-app/src/application/services/pane_create_service/mod.rs` and `crates/tide-app/src/domain/layout/tab_group.rs`).

### To-Be

Stage keeps the current `LeafGroup(TabGroup)` behavior and closes the drag-and-drop gaps around it.

1. **Stage tab drag starts from the tab bar**: pressing a Stage tab focuses it and enters `PaneDragState::PendingDrag`, matching Dock tab behavior.
2. **Stage tabs can be extracted into splits**: dragging a Stage tab onto a directional self-drop zone removes it from its current `TabGroup` and creates a new Stage split next to the remaining sibling tab.
3. **Stage tabs can move into another Stage `TabGroup`**: dropping a Stage tab onto another Stage `Pane` center zone merges it into that target `TabGroup`.
4. **Cross-area movement stays blocked**: Dock-to-Stage blocking remains in place, and Stage-to-Dock drops are rejected so Stage and Dock stay separate drag regions.
5. **Existing tab behavior remains**: click-to-switch, close tab, and stacked flat Stage tab bars continue to work with the new drag rules.
6. **Stage close focus is deterministic**: closing a non-active Stage tab keeps the current active tab focused, while closing the active Stage tab prefers the tab to the right and falls back to the tab to the left when the active tab was already last.

### Approach

1. **Start Stage tab drags from `HeaderHitAction::StageTab`**: align the Stage tab press path in `click_adapter/header.rs` with the Dock tab press path so the pressed Stage tab becomes the drag source after focus switches.
2. **Allow Stage self-extraction in drop targeting**: extend the self-drop allowance in `compute_tree_drop_target()` to multi-tab Stage `TabGroup`s so directional edge drops can split the source tab out.
3. **Keep self-drop previews local to the source rect**: directional self-drop preview rectangles must be computed from the dragged Stage pane's current visual rect, not from the entire Stage pane area.
4. **Keep Stage-only center merges and reject Stage-to-Dock drops**: preserve the existing Stage `DropZone::Center` merge path for Stage sources while adding the missing guard that keeps Stage panes out of Dock targets.
5. **Leave close, cycle, and stacked behavior intact**: the change only expands drag initiation and drop routing around existing Stage `TabGroup` operations.
6. **Route Stage close focus through `TabGroup` adjacency first**: when a focused Stage tab closes, resolve the next focus target from the containing `TabGroup` before falling back to the surrounding `SplitLayout`.

## Bounded Contexts

| Module | Path | Changes |
|--------|------|---------|
| click_adapter | `adapter/inward/click_adapter/header.rs` | Start `PaneDragState::PendingDrag` from `HeaderHitAction::StageTab` after focus switches to the pressed Stage tab. |
| drag_drop_adapter | `adapter/inward/drag_drop_adapter/mod.rs` | Allow directional self-drop only when the source Stage `Pane` belongs to a multi-tab `TabGroup`, while keeping cross-area drag targets blocked. |
| click_adapter | `adapter/inward/click_adapter/pane.rs` | Preserve Stage center merges for Stage sources and reject Stage-to-Dock drops before any Dock mutation path runs. |
| layout | `domain/layout/` | Reuse the existing `TabGroup` add, remove, and collapse behavior during Stage-tab extraction and Stage-to-Stage center merges. |

## Use Cases

### UC-1: Add Tab to Stage TabGroup

**Actor**: User
**Trigger**: User drops a pane onto a Stage pane's center zone, or triggers a "merge into tab" action on the focused Stage pane.
**Precondition**: Stage has at least one Pane. Target pane is in Stage.

**Flow**:
1. User drops source pane onto target pane with `DropZone::Center`, or invokes add-tab action.
2. If target is a `Node::Leaf(target_id)`: SplitLayout converts it to `Node::LeafGroup(TabGroup)` containing `[target_id, source_id]` with `source_id` as active tab. (This is the existing `add_tab_in_node` behavior at `domain/layout/mod.rs:502-525`.)
3. If target is already in a `Node::LeafGroup(TabGroup)`: `TabGroup::add_tab(source_id)` inserts after the active tab and sets source as active. (Existing `TabGroup::add_tab` at `domain/layout/tab_group.rs:32-37`.)
4. Focus moves to source pane.
5. Chrome invalidated, layout recomputed.

**Postcondition**: Source pane is now a tab in the target's TabGroup. Tab bar appears if TabGroup has 2+ tabs.

**Business Rules**:
- **BR-1 (Leaf-to-LeafGroup conversion)**: When `add_tab` targets a `Leaf` node, it is converted to a `LeafGroup` containing both the original pane and the new pane. The new pane becomes the active tab.
- **BR-2 (PaneId sync)**: After conversion, all PaneIds in the new LeafGroup MUST exist in `App.panes`, and the LeafGroup's active pane MUST be in `App.panes`.
- **BR-3 (Any PaneKind)**: Any PaneKind can be added to a Stage TabGroup -- not restricted to Terminal.
- **BR-4 (Self-drop prevention)**: Dropping a pane onto itself with `DropZone::Center` is a no-op.

### UC-2: Close Tab in Stage TabGroup

**Actor**: User
**Trigger**: User presses Cmd+W while focused on a pane in a Stage TabGroup, or clicks the close button on a Stage tab.
**Precondition**: Focused pane is part of a Stage TabGroup (LeafGroup node).

**Flow**:
1. User triggers close on pane P in a TabGroup with N tabs.
2. `TabGroup::remove_tab(P)` removes P from the tabs list and adjusts the active index. (Existing behavior at `domain/layout/tab_group.rs:41-55`.)
3. P is removed from `App.panes`.
4. If N was 2 (now 1 tab remaining): the `LeafGroup` is converted back to a `Leaf` containing the remaining PaneId.
5. If N was 1 (TabGroup becomes empty): the node is removed from SplitLayout entirely. If this was the last node, Stage shows Launcher.
6. Focus moves to the new active tab in the TabGroup (or the remaining Leaf, or the next Stage pane).
7. Chrome invalidated, layout recomputed.

**Postcondition**: Pane P is removed. TabGroup shrinks or collapses to Leaf. Focus is on a valid pane.

**Business Rules**:
- **BR-1 (LeafGroup-to-Leaf collapse)**: When a TabGroup goes from 2 tabs to 1, the `LeafGroup` node MUST be replaced by a `Leaf` node containing the remaining PaneId.
- **BR-2 (Empty TabGroup removal)**: When the last tab is removed from a TabGroup, the node is removed from SplitLayout (same as removing a Leaf).
- **BR-3 (Focus after close)**: Closing a non-active tab preserves the current active tab. Closing the active tab moves focus to the adjacent tab, preferring the tab to the right; if the closed tab was last, focus the new last tab. This matches `TabGroup::remove_tab`'s active index adjustment.
- **BR-4 (PaneId sync)**: After removal, no PaneId in SplitLayout references a pane not in `App.panes`, and vice versa.
- **BR-5 (Last pane in Stage)**: If closing the tab results in an empty Stage, a Launcher pane is created (same as current close-last-pane behavior).

### UC-3: Switch Or Drag a Stage Tab

**Actor**: User
**Trigger**: User clicks a tab in the Stage tab bar, drags a tab from the Stage tab bar, or uses Cmd+I/O to cycle tabs.
**Precondition**: Focused pane is part of a Stage TabGroup with 2+ tabs.

**Flow (click)**:
1. User clicks tab T in the tab bar of a Stage TabGroup.
2. `TabGroup::set_active(T)` updates the active index. (Existing at `domain/layout/tab_group.rs:59-65`.)
3. Focus moves to T.
4. Only the active tab's content renders in the TabGroup's layout slot.

**Flow (Cmd+I/O cycle)**:
1. User presses Cmd+I (prev) or Cmd+O (next) while in Stage.
2. `SplitLayout::all_tabs_flat()` builds the flat traversal of all Stage panes (Leaf panes + all tabs in each LeafGroup). (Existing at `domain/layout/mod.rs:607-624`.)
3. Current pane's position in the flat list is found; next/prev pane is selected (wrapping at boundaries).
4. If the next pane is in a different TabGroup, `set_active_tab` is called on that TabGroup.
5. Focus moves to the new pane.

**Flow (drag)**:
1. User presses a Stage tab T in the Stage tab bar.
2. Tide focuses T and records `PaneDragState::PendingDrag { source_pane: T, press_pos }`.
3. If the cursor crosses the drag threshold, Tide transitions to `PaneDragState::Dragging`.
4. Dropping T onto a directional self-drop zone removes T from its current `TabGroup` and creates a new sibling split next to the remaining Stage tab.
5. Dropping T onto another Stage `Pane` center zone merges T into that target `TabGroup`.

**Postcondition**: Active tab updated, focused pane rendered.

**Business Rules**:
- **BR-1 (Single active tab)**: Only one tab per TabGroup is active and rendered at any time. Other tabs are hidden.
- **BR-2 (Cycle order)**: Cmd+I/O traversal visits tabs within a TabGroup in order, then moves to the next leaf/group in layout tree order. Wraps around.
- **BR-3 (Focus sync)**: After switching tabs, `App.focus.focused` MUST equal the TabGroup's `active_pane()`.
- **BR-4 (Stage tab drag initiation)**: Pressing a Stage tab enters `PaneDragState::PendingDrag` after focus moves to the pressed tab.
- **BR-5 (Stage self-extraction)**: A Stage tab in a multi-tab `TabGroup` may use directional self-drop to split out into a new Stage leaf.
- **BR-6 (Stage-to-Stage merge)**: Dropping a Stage tab onto another Stage `Pane` center zone merges it into the target `TabGroup`.
- **BR-7 (Self-drop preview locality)**: A directional self-drop preview for a Stage tab is derived from the dragged pane's current Stage rect, so the silhouette never expands to the entire Stage pane area.

### UC-4: Stage Tab Bar Rendering

**Actor**: System (renderer)
**Trigger**: Layout recomputation or chrome invalidation.
**Precondition**: Stage contains at least one LeafGroup node.

**Flow**:
1. During `render_pane_chrome`, for each visual pane rect, check if the pane is in a Stage LeafGroup via `layout.tab_group_containing(pane_id)`.
2. If yes and the TabGroup has 2+ tabs: render a tab bar at the top of the pane rect, showing one tab per PaneId in the TabGroup.
3. Each tab shows: pane title (truncated), close button (x). Active tab is visually highlighted.
4. If TabGroup has only 1 tab: render as normal pane header (no tab bar).
5. Tab bar style follows VS Code design: compact height, horizontal layout, active tab distinguished by background color, inactive tabs subtly dimmed.

**Postcondition**: Tab bar correctly renders for all Stage LeafGroups with 2+ tabs.

**Business Rules**:
- **BR-1 (Tab bar visibility threshold)**: Tab bar is shown for LeafGroup nodes with 2+ tabs. Single-tab LeafGroups (or bare Leaf nodes) show the standard pane header.
- **BR-2 (Unified tab bar component)**: Stage and Dock tab bars use the same rendering logic. Extract a shared `render_tab_bar` function from the existing `render_dock_tab_bar`.
- **BR-3 (Tab close hit zone)**: Each tab's close button registers a `HeaderHitAction` for closing that specific tab (not the entire pane).
- **BR-4 (Tab click hit zone)**: Clicking a tab registers a `HeaderHitAction` to switch to that tab (`StageTab(pane_id)` or a new variant).
- **BR-5 (Overflow handling)**: When tabs exceed the available width, the Stage tab bar keeps horizontal scroll and auto-fits the active tab back into view so newly focused tabs are never stranded offscreen.

### UC-5: Drop Pane into Stage TabGroup (Center Drop Zone)

**Actor**: User
**Trigger**: User drags a pane and drops it onto the center zone of a Stage pane.
**Precondition**: Source pane exists in Stage. Target pane is in Stage. Source != target.

**Flow**:
1. User drags source pane over target pane. Drop zone indicator shows center merge zone.
2. User releases. `DropZone::Center` is detected.
3. `layout.remove(source)` removes source from its current position.
4. `layout.add_tab(target, source)` merges source into target's TabGroup. (Uses existing `add_tab_in_node` which handles both Leaf and LeafGroup targets.)
5. Focus moves to source. Chrome invalidated.

**Postcondition**: Source is now a tab in target's TabGroup in Stage.

**Business Rules**:
- **BR-1 (Center = tab merge)**: `DropZone::Center` on a Stage pane always means "add as tab", not "swap" or "insert below".
- **BR-2 (Cross-area block preserved)**: A Dock pane dropped onto a Stage target is rejected without mutating Stage layout, and this change adds the missing symmetric rejection for Stage panes dropped onto Dock targets.
- **BR-3 (Self-drop with sibling extraction)**: If source and target are in the same TabGroup, and source drops onto itself with center, it is a no-op. If source drops onto a different tab in the same TabGroup, source stays (already in the group).
- **BR-4 (Drop preview)**: `simulate_drop` should account for center zone producing a tab merge (no new split node), so the preview rect matches the target pane's rect.

### UC-6: Stacked Stage with TabGroups

**Actor**: User
**Trigger**: User presses Cmd+Enter (`ToggleStacked`) while in Stage.
**Precondition**: Stage has 2+ panes, some of which may be in TabGroups.

**Flow**:
1. User presses Cmd+Enter. Stage enters stacked mode.
2. The focused pane fills the entire Stage area.
3. A flat tab bar is rendered at the top showing ALL Stage panes in traversal order (from `all_tabs_flat()`). Tabs within the same TabGroup are visually grouped (e.g., with a subtle separator or grouping indicator).
4. User can click any tab to switch focus, or use Cmd+I/O to cycle.
5. Pressing Cmd+Enter again exits stacked mode. Layout returns to split view with TabGroups intact.

**Postcondition**: Stacked mode toggles between full-pane view and split view. TabGroup structure is preserved across toggles.

**Business Rules**:
- **BR-1 (Flat tab bar in stacked mode)**: Stacked mode shows all Stage panes in a single flat tab bar, regardless of TabGroup membership. This matches the current `render_stage_tab_bar` behavior which uses `layout.pane_ids()`.
- **BR-2 (TabGroup visual grouping)**: In the stacked flat tab bar, tabs belonging to the same TabGroup are visually distinguished (grouped together, with a subtle divider between groups).
- **BR-3 (TabGroup preservation)**: Entering and exiting stacked mode does not change the TabGroup structure. The same LeafGroup nodes persist in SplitLayout.

## Invariants

1. **PaneId sync (Architecture Invariant #1)**: Every PaneId in Stage's SplitLayout (including all tabs in all LeafGroups) MUST exist in `App.panes`, and every Stage pane in `App.panes` MUST appear in the SplitLayout.
2. **No empty TabGroups**: A `LeafGroup(TabGroup)` node in Stage MUST always have at least 1 tab. If the last tab is removed, the node is removed from the tree.
3. **Single-tab collapse**: A `LeafGroup` with exactly 1 tab SHOULD be collapsed to a `Leaf` for simplicity (not strictly required, but preferred to avoid unnecessary tab bar rendering for single-pane groups).
4. **Active tab validity**: `TabGroup.active` index MUST be within bounds (`0 <= active < tabs.len()`).
5. **Generation monotonicity (Architecture Invariant #5)**: `chrome_generation` is incremented on every tab add/remove/switch, ensuring the renderer picks up changes.
6. **Backward compatibility**: Old session snapshots with only `LayoutSnapshot::Leaf` nodes in Stage load correctly. `LayoutSnapshot::LeafGroup` nodes round-trip through the same serialization format as Dock `LeafGroup`s.

## Tests

| UC | BR | Test Function |
|----|-----|---------------|
| UC-1 | BR-1 | `adding_tab_to_stage_leaf_converts_to_leaf_group()` |
| UC-1 | BR-2 | `stage_tab_group_pane_ids_all_exist_in_app_panes()` |
| UC-1 | BR-3 | `any_pane_kind_can_be_added_to_stage_tab_group()` |
| UC-1 | BR-4 | `self_drop_center_in_stage_is_noop()` |
| UC-2 | BR-1 | `closing_tab_in_two_tab_group_collapses_to_leaf()` |
| UC-2 | BR-2 | `closing_last_tab_in_group_removes_node_from_layout()` |
| UC-2 | BR-3 | `focus_moves_to_adjacent_tab_after_close()` |
| UC-2 | BR-3 | `closing_non_active_stage_tab_keeps_the_current_active_tab_focused()` |
| UC-2 | BR-3 | `closing_active_stage_tab_prefers_the_right_adjacent_tab()` |
| UC-2 | BR-4 | `pane_id_sync_holds_after_stage_tab_close()` |
| UC-2 | BR-5 | `closing_last_stage_pane_in_tab_group_shows_launcher()` |
| UC-3 | BR-1 | `only_active_tab_renders_in_stage_tab_group()` |
| UC-3 | BR-2 | `cmd_io_cycles_through_all_stage_tabs_in_order()` |
| UC-3 | BR-3 | `focus_equals_active_pane_after_tab_switch()` |
| UC-3 | BR-4 | `pressing_stage_tab_enters_pending_drag_after_focus_switch()` |
| UC-3 | BR-5 | `directional_self_drop_splits_stage_tab_out_of_its_group()` |
| UC-3 | BR-6 | `dropping_stage_tab_on_other_stage_group_center_merges_it()` |
| UC-3 | BR-7 | `directional_self_drop_preview_uses_source_rect_not_stage_area()` |
| UC-4 | BR-1 | `tab_bar_shown_for_stage_groups_with_two_plus_tabs()` |
| UC-4 | BR-1 | `no_tab_bar_for_single_tab_stage_group()` |
| UC-4 | BR-3 | `stage_tab_close_button_registers_hit_zone()` |
| UC-4 | BR-4 | `stage_tab_click_registers_switch_hit_zone()` |
| UC-4 | BR-5 | `stacked_stage_tab_bar_scroll_updates_offset_under_cursor()` |
| UC-5 | BR-1 | `center_drop_on_stage_pane_merges_as_tab()` |
| UC-5 | BR-2 | `stage_pane_drop_target_never_enters_dock()` |
| UC-5 | BR-3 | `self_drop_center_in_same_tab_group_is_noop()` |
| UC-5 | BR-4 | `drop_preview_for_center_zone_matches_target_rect()` |
| UC-6 | BR-1 | `stacked_stage_shows_flat_tab_bar_of_all_panes()` |
| UC-6 | BR-2 | `stacked_tab_bar_groups_tabs_by_tab_group()` |
| UC-6 | BR-3 | `tab_group_structure_preserved_after_stacked_toggle()` |

## Location

| Item | Path |
|------|------|
| SplitLayout + TabGroup methods | `crates/tide-app/src/domain/layout/mod.rs` |
| TabGroup model | `crates/tide-app/src/domain/layout/tab_group.rs` |
| Node enum (Leaf, LeafGroup, Split) | `crates/tide-app/src/domain/layout/node.rs` |
| Tab bar rendering | `crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs` |
| Pane chrome rendering | `crates/tide-app/src/adapter/outward/view/chrome/` |
| Header hit zones | `crates/tide-app/src/adapter/outward/view/header.rs` |
| Drop handling (center zone) | `crates/tide-app/src/adapter/inward/click_adapter/pane.rs` |
| Pane creation service | `crates/tide-app/src/application/services/pane_create_service/mod.rs` |
| Action routing | `crates/tide-app/src/application/services/action_service/` |
| Session persistence | `crates/tide-app/src/application/services/session_service/` |
| Layout snapshot | `crates/tide-app/src/domain/layout/mod.rs` (LayoutSnapshot enum) |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` |
