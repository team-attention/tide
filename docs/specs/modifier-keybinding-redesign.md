# Spec: Modifier Keybinding Redesign

## Overview

### As-Is

The current keybinding system in `domain/input/mod.rs` has several problems:

1. **Inconsistent modifier mental model.** Navigate (Cmd+HJKL) targets Stage when FocusArea is Stage but forces a jump to Stage when FocusArea is Dock (`handle_navigate` in `workspace_service/mod.rs:189-194` sets `focused` to the stage terminal, pulling focus out of Dock). There is no way to navigate within Dock spatially.

2. **TabPrev/TabNext are Dock-only.** `cycle_tab()` (`workspace_service/mod.rs:245-280`) always operates on dock pane lists (pinned + terminal dock tabs) and forces `focus_area = FocusArea::Dock`. There is no way to cycle Stage TabGroup tabs via keyboard, despite Stage now supporting TabGroups (per `stage-tab-groups.md`).

3. **Redundant/conflicting GlobalAction variants.** `SplitHorizontalHere` and `SplitVerticalHere` both call `dock_split_new_tab_group()` (`action_service/mod.rs:438-445`), which always targets Dock. The "Here" suffix is misleading — they do not split at the current pane's location. Meanwhile `SplitVertical`/`SplitHorizontal` call `split_with_launcher()`, which targets Stage. The naming conflates split direction with split target area.

4. **Dead bindings.** `BrowserBack`/`BrowserForward` are bound to Cmd+Shift+[/] (`Key::Char('{')` / `Key::Char('}')`), conflicting conceptually with Cmd+[/] for WorkspacePrev/Next. These are rarely used and better served by browser-internal navigation.

5. **Arrow key duplication.** Cmd+Arrow keys duplicate Cmd+HJKL for Navigate, consuming four bindings for no added value (`default_bindings()` lines 428-431).

6. **No cross-area operations.** There is no modifier convention for "operate on the other area." A user focused in Stage cannot split/tab/navigate in Dock without first switching focus.

7. **ToggleZoom dispatches ToggleStacked.** `ToggleZoom` (`action_service/mod.rs:493-495`) calls `handle_toggle_stacked()`. The action name does not match its behavior.

### To-Be

A consistent modifier-based keybinding system built on one mental model:

**"Cmd = current FocusArea, +Ctrl = Dock cross-area, +Shift = flip orientation"**

Key changes:
1. **Navigate stays in current FocusArea.** Cmd+HJKL navigates within the focused area (Stage or Dock). No forced area switching.
2. **Cross-area Dock operations via Cmd+Ctrl.** Cmd+Ctrl+HJKL navigates Dock, Cmd+Ctrl+T creates a Dock tab, Cmd+Ctrl+I/O cycles Dock tabs — all without changing FocusArea.
3. **TabPrev/TabNext work in both areas.** When Stage is focused, Cmd+I/O cycles Stage TabGroup tabs. When Dock is focused, they cycle Dock tabs. Cmd+Ctrl+I/O always targets Dock regardless of focus.
4. **Split semantics cleaned up.** Cmd+\ = SplitVertical (current area), Cmd+Shift+\ = SplitHorizontal (current area). Cmd+Ctrl+\ and Cmd+Ctrl+Shift+\ target Dock.
5. **Removed variants.** `BrowserBack`, `BrowserForward`, `ToggleZoom`, `SplitHorizontalHere`, `SplitVerticalHere` removed from GlobalAction.
6. **Removed bindings.** Cmd+Arrow navigate bindings removed from `default_bindings()`.
7. **New Dock-targeting variants.** `DockNavigate(Direction)`, `DockSplitVertical`, `DockSplitHorizontal`, `DockNewTab`, `DockTabPrev`, `DockTabNext` added.
8. **ToggleZoom renamed to ToggleStacked** in binding (Cmd+Enter maps to `ToggleStacked`). The `ToggleZoom` variant is removed.

Complete binding table (HJKL only, no arrow keys):

| Operation | Current Area (Cmd) | Dock Cross-Area (Cmd+Ctrl) |
|-----------|-------------------|---------------------------|
| Navigate Up | Cmd+K | Cmd+Ctrl+K |
| Navigate Down | Cmd+J | Cmd+Ctrl+J |
| Navigate Left | Cmd+H | Cmd+Ctrl+H |
| Navigate Right | Cmd+L | Cmd+Ctrl+L |
| Split Vertical | Cmd+\ | Cmd+Ctrl+\ |
| Split Horizontal | Cmd+Shift+\ | Cmd+Ctrl+Shift+\ |
| New Tab | Cmd+T | Cmd+Ctrl+T |
| Tab Prev | Cmd+I | Cmd+Ctrl+I |
| Tab Next | Cmd+O | Cmd+Ctrl+O |

Unchanged bindings:
- Cmd+[/] = WorkspacePrev/Next
- Cmd+1/2/3/4 = FocusArea slots
- Cmd+Shift+N/W = NewWorkspace/CloseWorkspace
- Cmd+W = ClosePane
- Cmd+Enter = ToggleStacked (was ToggleZoom, same dispatch)
- Cmd+Shift+O = FileFinder

### Approach

1. **Add new GlobalAction variants.** Add `DockNavigate(Direction)`, `DockSplitVertical`, `DockSplitHorizontal`, `DockNewTab`, `DockTabPrev`, `DockTabNext` to the `GlobalAction` enum, with corresponding `label()`, `action_key()`, `from_action_key()`, and `all_actions()` entries.
2. **Remove old variants.** Remove `BrowserBack`, `BrowserForward`, `ToggleZoom`, `SplitHorizontalHere`, `SplitVerticalHere` from `GlobalAction`. Remove all references in `action_key()`, `from_action_key()`, `label()`, `all_actions()`, and `handle_global_action()`.
3. **Update default_bindings().** Remove Cmd+Arrow bindings. Rebind Cmd+\ to `SplitVertical`, Cmd+Shift+\ to `SplitHorizontal`. Add Cmd+Ctrl bindings for all Dock-targeting actions. Map Cmd+Enter to `ToggleStacked`.
4. **Update match_hotkey().** Add Cmd+Ctrl modifier branches for HJKL, \, T, I, O. Remove BrowserBack/Forward branches.
5. **Fix Navigate behavior.** In `handle_navigate()`, when FocusArea is Dock, navigate within Dock spatially (do not force focus back to Stage). When FocusArea is Stage, navigate within Stage only.
6. **Fix cycle_tab behavior.** Make `cycle_tab()` FocusArea-aware: when Stage is focused, cycle Stage TabGroup tabs via `all_tabs_flat()` on the Stage layout. When Dock is focused, cycle Dock tabs (current behavior).
7. **Add DockNavigate handler.** New handler that always targets Dock navigation without changing FocusArea. When FocusArea is already Dock, behaves identically to Navigate.
8. **Add Dock split/tab handlers.** `DockSplitVertical`/`DockSplitHorizontal` call existing `dock_split_new_tab_group()`. `DockNewTab` creates a new tab in Dock. `DockTabPrev`/`DockTabNext` call `cycle_tab` targeting Dock.
9. **Settings migration.** `from_action_key()` maps old action keys (`"BrowserBack"`, `"BrowserForward"`, `"ToggleZoom"`, `"SplitHorizontalHere"`, `"SplitVerticalHere"`) to `None`, so stale user overrides are silently dropped.
10. **Update `BrowserReload` binding.** `BrowserReload` (Cmd+R) remains unchanged — it is pane-contextual (only acts when a Browser pane is focused).

## Bounded Contexts

| Module | Path | Changes |
|--------|------|---------|
| input | `domain/input/mod.rs` | Add 6 new GlobalAction variants, remove 5 old variants. Update `default_bindings()`, `match_hotkey()`, `label()`, `action_key()`, `from_action_key()`, `all_actions()`. |
| action_service | `application/services/action_service/mod.rs` | Route new Dock-targeting actions to existing dock methods. Remove BrowserBack/Forward/ToggleZoom/SplitHere handlers. |
| workspace_service | `application/services/workspace_service/mod.rs` | Fix `handle_navigate()` to stay in current FocusArea. Make `cycle_tab()` FocusArea-aware. Add `dock_navigate()`, `dock_cycle_tab()` methods. |
| workspace_nav_port | `application/ports/inward/workspace_nav_port/mod.rs` | Add `dock_navigate()`, `dock_cycle_tab()` port methods. |
| renderer (view) | `adapter/outward/view/` | Update keybinding display strings where old actions are referenced. |
| config (view) | `adapter/outward/view/chrome/config.rs` | Display new action labels in keybinding config page. |

## Use Cases

### UC-1: Navigate Within Current FocusArea

**Actor**: User
**Trigger**: User presses Cmd+H/J/K/L while focused in Stage or Dock.
**Precondition**: At least 2 panes exist in the current FocusArea's layout.

**Flow**:
1. User presses Cmd+K (Navigate Up).
2. Router matches hotkey to `GlobalAction::Navigate(Direction::Up)`.
3. `handle_navigate()` checks `self.focus.focus_area`.
4. If Stage: spatial navigation within `self.layout` (Stage SplitLayout). Focus moves to the nearest pane above.
5. If Dock: spatial navigation within the focused terminal's `dock_layout`. Focus moves to the nearest dock pane above.
6. FocusArea does NOT change.

**Postcondition**: Focus moves to the nearest pane in the given direction within the same FocusArea. FocusArea is unchanged.

**Business Rules**:
- **BR-1 (Area confinement)**: Navigate(Direction) MUST NOT change FocusArea. If no pane exists in the given direction within the current area, the action is a no-op.
- **BR-2 (Dock spatial navigation)**: When FocusArea is Dock, Navigate uses the dock's SplitLayout for spatial neighbor lookup, not the Stage layout.
- **BR-3 (Zoomed mode override)**: When Stage is in stacked/zoomed mode, Navigate Left/Right cycles through stacked panes (existing behavior preserved).

### UC-2: Cross-Area Dock Navigation

**Actor**: User
**Trigger**: User presses Cmd+Ctrl+H/J/K/L from any FocusArea.
**Precondition**: Dock has at least 2 panes in its layout.

**Flow**:
1. User presses Cmd+Ctrl+L (DockNavigate Right) while focused in Stage.
2. Router matches hotkey to `GlobalAction::DockNavigate(Direction::Right)`.
3. `handle_global_action()` dispatches to `dock_navigate(direction)`.
4. `dock_navigate()` performs spatial navigation within the dock's SplitLayout, updating `dock_focused` and the active tab.
5. FocusArea remains Stage (or whatever it was).

**Postcondition**: Dock's active/focused pane changes. FocusArea is unchanged.

**Business Rules**:
- **BR-1 (No focus area change)**: DockNavigate MUST NOT change FocusArea, even though it operates on Dock.
- **BR-2 (Dock identity when Dock focused)**: When FocusArea is already Dock, DockNavigate behaves identically to Navigate — both target Dock.
- **BR-3 (Dock closed)**: If Dock is not open/visible, DockNavigate is a no-op.

### UC-3: Tab Cycling in Stage

**Actor**: User
**Trigger**: User presses Cmd+I or Cmd+O while FocusArea is Stage.
**Precondition**: Stage has at least 2 panes (across leaves and TabGroups).

**Flow**:
1. User presses Cmd+O (TabNext) while in Stage.
2. Router matches to `GlobalAction::TabNext`.
3. `cycle_tab(1)` checks `self.focus.focus_area`.
4. FocusArea is Stage: builds flat tab list from `self.layout.all_tabs_flat()` (Stage layout).
5. Finds current pane's position, advances to next.
6. If next pane is in a different TabGroup, `set_active_tab` is called on that group.
7. Focus moves to the next pane. FocusArea remains Stage.

**Postcondition**: Focus advances to the next Stage pane in traversal order. TabGroup active tabs are updated as needed.

**Business Rules**:
- **BR-1 (Stage tab cycling)**: When FocusArea is Stage, TabPrev/TabNext cycle through Stage panes in layout traversal order (from `all_tabs_flat()`).
- **BR-2 (Dock tab cycling)**: When FocusArea is Dock, TabPrev/TabNext cycle through Dock tabs (pinned + terminal dock tabs) — the current `cycle_tab()` behavior.
- **BR-3 (Wrap around)**: Cycling past the last pane wraps to the first, and vice versa.
- **BR-4 (TabGroup active sync)**: When cycling into a TabGroup, the target pane becomes the active tab of that group.

### UC-4: Cross-Area Dock Tab Cycling

**Actor**: User
**Trigger**: User presses Cmd+Ctrl+I or Cmd+Ctrl+O from any FocusArea.
**Precondition**: Dock has at least 2 tabs.

**Flow**:
1. User presses Cmd+Ctrl+O (DockTabNext) while in Stage.
2. Router matches to `GlobalAction::DockTabNext`.
3. `dock_cycle_tab(1)` cycles through Dock tab list (pinned + terminal dock).
4. Dock's focused pane updates.
5. FocusArea remains Stage.

**Postcondition**: Dock's active tab advances. FocusArea unchanged.

**Business Rules**:
- **BR-1 (No focus area change)**: DockTabPrev/DockTabNext MUST NOT change FocusArea.
- **BR-2 (Opens dock if closed)**: If dock is closed, DockTabPrev/DockTabNext opens it (sets `dock_open = true`), matching current `cycle_tab()` behavior.

### UC-5: Split in Current Area

**Actor**: User
**Trigger**: User presses Cmd+\ (SplitVertical) or Cmd+Shift+\ (SplitHorizontal).
**Precondition**: A pane is focused.

**Flow**:
1. User presses Cmd+\ while in Stage.
2. Router matches to `GlobalAction::SplitVertical`.
3. `handle_global_action()` checks FocusArea.
4. If Stage: calls `split_with_launcher(SplitDirection::Vertical)` — splits the focused Stage pane vertically.
5. If Dock: calls `dock_split_new_tab_group(SplitDirection::Vertical)` — splits the dock area vertically.

**Postcondition**: A new pane is created via split in the current FocusArea.

**Business Rules**:
- **BR-1 (Area-aware split)**: SplitVertical/SplitHorizontal target the current FocusArea. When in Stage they split Stage layout; when in Dock they split Dock layout.
- **BR-2 (Direction semantics)**: SplitVertical creates a left/right split (vertical divider). SplitHorizontal creates a top/bottom split (horizontal divider). Cmd+\ = vertical, Cmd+Shift+\ = horizontal (Shift flips orientation).

### UC-6: Cross-Area Dock Split

**Actor**: User
**Trigger**: User presses Cmd+Ctrl+\ (DockSplitVertical) or Cmd+Ctrl+Shift+\ (DockSplitHorizontal).
**Precondition**: Dock is open or will be opened by the action.

**Flow**:
1. User presses Cmd+Ctrl+\ while in Stage.
2. Router matches to `GlobalAction::DockSplitVertical`.
3. `handle_global_action()` dispatches to `dock_split_new_tab_group(SplitDirection::Vertical)`.
4. A new dock pane is created. FocusArea remains Stage.

**Postcondition**: Dock gains a new split pane. FocusArea unchanged.

**Business Rules**:
- **BR-1 (Always targets Dock)**: DockSplit variants always target Dock layout regardless of current FocusArea.
- **BR-2 (No focus area change)**: FocusArea is not changed by DockSplit actions.

### UC-7: Cross-Area Dock New Tab

**Actor**: User
**Trigger**: User presses Cmd+Ctrl+T from any FocusArea.
**Precondition**: A terminal is focused in Stage (provides dock context).

**Flow**:
1. User presses Cmd+Ctrl+T while in Stage.
2. Router matches to `GlobalAction::DockNewTab`.
3. A new tab is created in the Dock area of the currently focused terminal.
4. FocusArea remains unchanged.

**Postcondition**: Dock gains a new tab. FocusArea unchanged.

**Business Rules**:
- **BR-1 (Always targets Dock)**: DockNewTab creates a tab in the Dock, not in Stage.
- **BR-2 (No focus area change)**: FocusArea is not changed.

### UC-8: Settings Migration for Removed Actions

**Actor**: System
**Trigger**: User launches Tide with a settings file containing old action keys.
**Precondition**: User's keybinding overrides reference removed action keys.

**Flow**:
1. Settings loader reads keybinding overrides from config.
2. For each override, `GlobalAction::from_action_key()` is called.
3. Old keys (`"BrowserBack"`, `"BrowserForward"`, `"ToggleZoom"`, `"SplitHorizontalHere"`, `"SplitVerticalHere"`) return `None`.
4. These overrides are silently skipped.
5. Remaining valid overrides are applied normally via `KeybindingMap::with_overrides()`.

**Postcondition**: Old action keys do not cause errors. Valid overrides are applied.

**Business Rules**:
- **BR-1 (Graceful degradation)**: Removed action keys in user settings MUST NOT cause a crash or error. They are silently ignored.
- **BR-2 (ToggleZoom migration)**: `"ToggleZoom"` in settings maps to `None` (dropped). Users who want the behavior must rebind to `"ToggleStacked"`.

## Invariants

1. **FocusArea stability**: Cross-area (Cmd+Ctrl) operations MUST NOT change `self.focus.focus_area`. Only explicit FocusArea actions (Cmd+1/2/3/4, clicking in a different area) change FocusArea.
2. **Modifier orthogonality**: Every Cmd+{key} binding that has a Cmd+Ctrl+{key} counterpart must follow the pattern: Cmd = current area, Cmd+Ctrl = Dock. No exceptions.
3. **Shift = flip orientation**: For split operations, Cmd+\ = vertical, Cmd+Shift+\ = horizontal. This applies in both the current-area and cross-area (Cmd+Ctrl) variants.
4. **Input routing priority (Architecture Invariant #4)**: Modal -> FocusArea -> Router -> TextInput. This redesign does not change the priority chain.
5. **No arrow key navigate bindings**: Cmd+Arrow bindings are removed. Only HJKL is supported for directional navigation.
6. **Backward compatibility**: Old action keys in `from_action_key()` return `None` rather than causing parse failures.

## Tests

| UC | BR | Test Function |
|----|-----|---------------|
| UC-1 | BR-1 | `navigate_in_stage_does_not_change_focus_area()` |
| UC-1 | BR-1 | `navigate_in_dock_does_not_change_focus_area()` |
| UC-1 | BR-2 | `navigate_in_dock_uses_dock_layout_for_spatial_lookup()` |
| UC-1 | BR-3 | `navigate_in_zoomed_stage_cycles_stacked_panes()` |
| UC-2 | BR-1 | `dock_navigate_does_not_change_focus_area()` |
| UC-2 | BR-2 | `dock_navigate_when_dock_focused_behaves_like_navigate()` |
| UC-2 | BR-3 | `dock_navigate_when_dock_closed_is_noop()` |
| UC-3 | BR-1 | `tab_prev_next_in_stage_cycles_stage_panes()` |
| UC-3 | BR-2 | `tab_prev_next_in_dock_cycles_dock_tabs()` |
| UC-3 | BR-3 | `tab_cycling_wraps_around_at_boundaries()` |
| UC-3 | BR-4 | `tab_cycling_into_tab_group_sets_active_tab()` |
| UC-4 | BR-1 | `dock_tab_next_does_not_change_focus_area()` |
| UC-4 | BR-2 | `dock_tab_next_opens_dock_if_closed()` |
| UC-5 | BR-1 | `split_vertical_in_stage_splits_stage_layout()` |
| UC-5 | BR-1 | `split_vertical_in_dock_splits_dock_layout()` |
| UC-5 | BR-2 | `cmd_backslash_maps_to_split_vertical()` |
| UC-5 | BR-2 | `cmd_shift_backslash_maps_to_split_horizontal()` |
| UC-6 | BR-1 | `dock_split_vertical_always_targets_dock()` |
| UC-6 | BR-2 | `dock_split_does_not_change_focus_area()` |
| UC-7 | BR-1 | `dock_new_tab_always_targets_dock()` |
| UC-7 | BR-2 | `dock_new_tab_does_not_change_focus_area()` |
| UC-8 | BR-1 | `removed_action_keys_return_none_from_parse()` |
| UC-8 | BR-2 | `toggle_zoom_in_settings_is_silently_dropped()` |

## Location

| Item | Path |
|------|------|
| GlobalAction enum | `crates/tide-app/src/domain/input/mod.rs` |
| Hotkey / KeybindingMap | `crates/tide-app/src/domain/input/mod.rs` |
| Router / match_hotkey | `crates/tide-app/src/domain/input/mod.rs` |
| Action dispatch | `crates/tide-app/src/application/services/action_service/mod.rs` |
| Navigate / cycle_tab | `crates/tide-app/src/application/services/workspace_service/mod.rs` |
| Workspace nav port | `crates/tide-app/src/application/ports/inward/workspace_nav_port/mod.rs` |
| Keybinding config UI | `crates/tide-app/src/adapter/outward/view/chrome/config.rs` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` |
