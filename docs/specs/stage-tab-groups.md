# Spec: Stage TabGroups

## Overview

### As-Is

Stage uses `SplitLayout` with `Node::Leaf(PaneId)` leaves exclusively. Each leaf holds a single Terminal Pane. The `Node` enum already supports `LeafGroup(TabGroup)` and SplitLayout has methods for TabGroup operations (`add_tab`, `add_tab_to_first_group`, `set_active_tab`, `tab_group_containing`, `split_with_leaf_group`), but these are only used for Dock layouts.

Key current behaviors:
1. **Stage leaf type**: `Node::Leaf(PaneId)` only (`layout-v2.md` decision: "Stage uses SplitLayout with single-PaneId leaves -- no TabGroups").
2. **Tab bar in Stage**: Only rendered in zoomed/stacked mode via `render_stage_tab_bar` (`adapter/outward/view/chrome/tab_bar.rs`), which shows a flat list of all Stage Panes. No per-TabGroup tab bar exists for Stage.
3. **Center drop in Stage**: `DropZone::Center` on Stage panes falls through to the else branch in `adapter/inward/click_adapter/pane.rs:473-480`, which calls `layout_remove` + `layout_insert_pane` -- effectively treating center drops as directional inserts, not tab merges.
4. **`add_tab_in_node`** (`domain/layout/mod.rs:502-525`): Already handles converting a `Node::Leaf` to `Node::LeafGroup` when `add_tab` targets a Leaf. This infrastructure exists but is never called for Stage layouts.

### To-Be

Stage supports `LeafGroup(TabGroup)` nodes identically to Dock. Any Pane type (not just Terminal) can be grouped into a Stage TabGroup. Tab bar UI follows a unified design referencing VS Code patterns.

1. **Stage leaf type**: Both `Node::Leaf(PaneId)` and `Node::LeafGroup(TabGroup)` in Stage's SplitLayout.
2. **Tab bar rendering**: Per-TabGroup tab bar shown for LeafGroup nodes with 2+ tabs. Single-tab LeafGroups render as normal pane headers (no tab bar). Uses a unified tab bar component shared with Dock, styled after VS Code (compact, horizontally scrollable, close button per tab, active tab highlight).
3. **Center drop**: `DropZone::Center` on a Stage pane merges the source into the target's TabGroup (creating a LeafGroup if the target is a Leaf).
4. **Tab operations**: `cycle_tab` (Cmd+I/O in Stage), click-to-switch, close tab (Cmd+W) all work within Stage TabGroups.
5. **Zoom with TabGroups**: Zoomed Stage shows a flat tab bar of all Stage panes (current behavior preserved), with TabGroup membership indicated by visual grouping.

### Approach

1. **Enable LeafGroup in Stage SplitLayout**: Remove the conceptual restriction. No code change needed in `SplitLayout` itself -- the `add_tab` and `LeafGroup` infrastructure already works. Changes are in the callers that create/manipulate Stage layout.
2. **Add tab to Stage TabGroup**: Wire up a new port method or extend existing ones to call `layout.add_tab(target, new_pane)` for Stage panes.
3. **Handle center drop for Stage**: In `click_adapter/pane.rs`, when both source and target are Stage panes and zone is `DropZone::Center`, call `layout.add_tab(target, source)` instead of `layout_insert_pane`.
4. **Close tab in Stage**: When closing a pane that is in a Stage TabGroup, call `TabGroup::remove_tab`. If the TabGroup becomes single-tab, convert `LeafGroup` back to `Leaf`. If empty, remove the node.
5. **Stage tab bar rendering**: In `tab_bar.rs`, detect Stage LeafGroup nodes (via `layout.tab_group_containing(pane_id)`) and render a tab bar identical to Dock's, reusing `render_dock_tab_bar` or extracting a shared component.
6. **Tab cycling**: Extend Stage Cmd+I/O to use `all_tabs_flat()` which already traverses both Leaf and LeafGroup nodes.
7. **Session persistence**: `LayoutSnapshot::LeafGroup` already handles serialization. Old snapshots with only `Leaf` nodes load correctly (backward compatible).

## Bounded Contexts

| Module | Path | Changes |
|--------|------|---------|
| layout | `domain/layout/` | Add `remove_tab_or_node` method that removes a tab from a LeafGroup and collapses to Leaf if single remaining. No structural changes to Node enum. |
| input | `domain/input/` | Add `GlobalAction::AddToTabGroup` or extend existing `SplitVertical`/`SplitHorizontal` with a tab-merge variant. |
| renderer (view) | `adapter/outward/view/chrome/tab_bar.rs` | Detect Stage TabGroups, render per-group tab bars. Extract shared tab bar component from Dock rendering. |
| renderer (view) | `adapter/outward/view/chrome/` | Update `render_pane_chrome` to detect Stage LeafGroups and render tab bars. |
| click_adapter | `adapter/inward/click_adapter/pane.rs` | Handle `DropZone::Center` for Stage panes as tab merge. Handle tab click/close in Stage tab bar. |
| pane_create_service | `application/services/pane_create_service/` | When creating a pane in Stage, optionally add as tab to focused TabGroup instead of splitting. |
| action_service | `application/services/action_service/` | Route tab switching/closing for Stage TabGroups. |
| session_service | `application/services/session_service/` | No changes needed -- `LayoutSnapshot::LeafGroup` already serializes/deserializes. |

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
- **BR-3 (Focus after close)**: Focus moves to the tab that was adjacent to the closed tab (prefer the tab to the right; if closed tab was last, focus the new last tab). This matches `TabGroup::remove_tab`'s active index adjustment.
- **BR-4 (PaneId sync)**: After removal, no PaneId in SplitLayout references a pane not in `App.panes`, and vice versa.
- **BR-5 (Last pane in Stage)**: If closing the tab results in an empty Stage, a Launcher pane is created (same as current close-last-pane behavior).

### UC-3: Switch Active Tab in Stage TabGroup

**Actor**: User
**Trigger**: User clicks a tab in the Stage tab bar, or uses Cmd+I/O to cycle tabs.
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

**Postcondition**: Active tab updated, focused pane rendered.

**Business Rules**:
- **BR-1 (Single active tab)**: Only one tab per TabGroup is active and rendered at any time. Other tabs are hidden.
- **BR-2 (Cycle order)**: Cmd+I/O traversal visits tabs within a TabGroup in order, then moves to the next leaf/group in layout tree order. Wraps around.
- **BR-3 (Focus sync)**: After switching tabs, `App.focus.focused` MUST equal the TabGroup's `active_pane()`.

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
- **BR-5 (Overflow handling)**: When tabs exceed the available width, tabs are truncated with ellipsis. Scroll or overflow behavior can be added later.

### UC-5: Drop Pane into Stage TabGroup (Center Drop Zone)

**Actor**: User
**Trigger**: User drags a pane and drops it onto the center zone of a Stage pane.
**Precondition**: Source pane exists. Target pane is in Stage. Source != target.

**Flow**:
1. User drags source pane over target pane. Drop zone indicator shows center merge zone.
2. User releases. `DropZone::Center` is detected.
3. If source is in Stage: `layout.remove(source)` removes source from its current position. Then `layout.add_tab(target, source)` merges source into target's TabGroup. (Uses existing `add_tab_in_node` which handles both Leaf and LeafGroup targets.)
4. If source is in Dock: source is removed from Dock layout, then added to Stage TabGroup via `layout.add_tab(target, source)`.
5. Focus moves to source. Chrome invalidated.

**Postcondition**: Source is now a tab in target's TabGroup in Stage.

**Business Rules**:
- **BR-1 (Center = tab merge)**: `DropZone::Center` on a Stage pane always means "add as tab", not "swap" or "insert below". This differs from current Stage behavior where center falls through to directional insert.
- **BR-2 (Cross-region drop)**: A Dock pane dropped onto Stage center zone is removed from Dock and merged into the Stage TabGroup. The pane's PaneKind is preserved.
- **BR-3 (Self-drop with sibling extraction)**: If source and target are in the same TabGroup, and source drops onto itself with center, it is a no-op. If source drops onto a different tab in the same TabGroup, source stays (already in the group).
- **BR-4 (Drop preview)**: `simulate_drop` should account for center zone producing a tab merge (no new split node), so the preview rect matches the target pane's rect.

### UC-6: Zoomed Stage with TabGroups

**Actor**: User
**Trigger**: User presses Cmd+Enter to toggle zoom while in Stage.
**Precondition**: Stage has 2+ panes, some of which may be in TabGroups.

**Flow**:
1. User presses Cmd+Enter. Stage enters zoomed/stacked mode.
2. The focused pane fills the entire Stage area.
3. A flat tab bar is rendered at the top showing ALL Stage panes in traversal order (from `all_tabs_flat()`). Tabs within the same TabGroup are visually grouped (e.g., with a subtle separator or grouping indicator).
4. User can click any tab to switch focus, or use Cmd+I/O to cycle.
5. Pressing Cmd+Enter again exits zoom. Layout returns to split view with TabGroups intact.

**Postcondition**: Zoom toggles between full-pane view and split view. TabGroup structure is preserved across zoom toggles.

**Business Rules**:
- **BR-1 (Flat tab bar in zoom)**: Zoomed mode shows all Stage panes in a single flat tab bar, regardless of TabGroup membership. This matches the current `render_stage_tab_bar` behavior which uses `layout.pane_ids()`.
- **BR-2 (TabGroup visual grouping)**: In the zoomed flat tab bar, tabs belonging to the same TabGroup are visually distinguished (grouped together, with a subtle divider between groups).
- **BR-3 (TabGroup preservation)**: Entering and exiting zoom does not change the TabGroup structure. The same LeafGroup nodes persist in SplitLayout.

## Invariants

1. **PaneId sync (Architecture Invariant #1)**: Every PaneId in Stage's SplitLayout (including all tabs in all LeafGroups) MUST exist in `App.panes`, and every Stage pane in `App.panes` MUST appear in the SplitLayout.
2. **No empty TabGroups**: A `LeafGroup(TabGroup)` node in Stage MUST always have at least 1 tab. If the last tab is removed, the node is removed from the tree.
3. **Single-tab collapse**: A `LeafGroup` with exactly 1 tab SHOULD be collapsed to a `Leaf` for simplicity (not strictly required, but preferred to avoid unnecessary tab bar rendering for single-pane groups).
4. **Active tab validity**: `TabGroup.active` index MUST be within bounds (`0 <= active < tabs.len()`).
5. **Generation monotonicity (Architecture Invariant #5)**: `chrome_generation` is incremented on every tab add/remove/switch, ensuring the renderer picks up changes.
6. **Backward compatibility**: Old session snapshots with only `LayoutSnapshot::Leaf` nodes in Stage load correctly. `LayoutSnapshot::LeafGroup` nodes in Stage are a new addition but use the same serialization format as Dock LeafGroups.

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
| UC-2 | BR-4 | `pane_id_sync_holds_after_stage_tab_close()` |
| UC-2 | BR-5 | `closing_last_stage_pane_in_tab_group_shows_launcher()` |
| UC-3 | BR-1 | `only_active_tab_renders_in_stage_tab_group()` |
| UC-3 | BR-2 | `cmd_io_cycles_through_all_stage_tabs_in_order()` |
| UC-3 | BR-3 | `focus_equals_active_pane_after_tab_switch()` |
| UC-4 | BR-1 | `tab_bar_shown_for_stage_groups_with_two_plus_tabs()` |
| UC-4 | BR-1 | `no_tab_bar_for_single_tab_stage_group()` |
| UC-4 | BR-3 | `stage_tab_close_button_registers_hit_zone()` |
| UC-4 | BR-4 | `stage_tab_click_registers_switch_hit_zone()` |
| UC-5 | BR-1 | `center_drop_on_stage_pane_merges_as_tab()` |
| UC-5 | BR-2 | `dock_pane_dropped_on_stage_center_merges_into_tab_group()` |
| UC-5 | BR-3 | `self_drop_center_in_same_tab_group_is_noop()` |
| UC-5 | BR-4 | `drop_preview_for_center_zone_matches_target_rect()` |
| UC-6 | BR-1 | `zoomed_stage_shows_flat_tab_bar_of_all_panes()` |
| UC-6 | BR-2 | `zoomed_tab_bar_groups_tabs_by_tab_group()` |
| UC-6 | BR-3 | `tab_group_structure_preserved_after_zoom_toggle()` |

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
