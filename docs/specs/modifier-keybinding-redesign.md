# Spec: Modifier Keybinding Redesign

## Overview

### As-Is

The current keybinding system in `domain/input/mod.rs` has several problems:

1. **Inconsistent modifier mental model.** Navigate (Cmd+HJKL) targets Stage when FocusArea is Stage but forces a jump to Stage when FocusArea is Dock (`handle_navigate` in `workspace_service/mod.rs:189-194` sets `focused` to the stage terminal, pulling focus out of Dock). There is no way to navigate within Dock spatially.

2. **TabPrev/TabNext are Dock-only in split layouts.** `cycle_tab()` (`workspace_service/mod.rs`) originally operated on Dock tab lists. Stage now uses split-only normal layout, so Stage TabPrev/TabNext should be reserved for `ViewMode::Stacked`.

3. **Redundant/conflicting GlobalAction variants.** `SplitHorizontalHere` and `SplitVerticalHere` both call `dock_split_new_tab_group()` (`action_service/mod.rs:438-445`), which always targets Dock. The "Here" suffix is misleading — they do not split at the current pane's location. Meanwhile `SplitVertical`/`SplitHorizontal` call `split_with_launcher()`, which targets Stage. The naming conflates split direction with split target area.

4. **Dead bindings.** `BrowserBack`/`BrowserForward` are bound to Cmd+Shift+[/] (`Key::Char('{')` / `Key::Char('}')`), conflicting conceptually with Cmd+[/] for WorkspacePrev/Next. These are rarely used and better served by browser-internal navigation.

5. **Arrow key duplication.** Cmd+Arrow keys duplicate Cmd+HJKL for Navigate, consuming four bindings for no added value (`default_bindings()` lines 428-431).

6. **No cross-area operations.** There is no modifier convention for "operate on the other area." A user focused in Stage cannot split/tab/navigate in Dock without first switching focus.

7. **ToggleZoom dispatches ToggleStacked.** `ToggleZoom` (`action_service/mod.rs:493-495`) calls `handle_toggle_stacked()`. The action name does not match its behavior.

### To-Be

A consistent modifier-based keybinding system built on one mental model:

**"Cmd = current FocusArea, Cmd+Shift+H/J/K/L = Dock navigation, +Shift = split orientation"**

Visibility toggles are explicit exceptions to the split/navigation model:
`Cmd+E` toggles Workspace rail, `Cmd+B` toggles FileTree View, and
`Cmd+Backslash` toggles Dock.

Key changes:
1. **Navigate stays in current FocusArea.** Cmd+HJKL navigates within the focused area (Stage or Dock). No forced area switching.
2. **Cross-area Dock navigation via Cmd+Shift.** Cmd+Shift+HJKL navigates Dock without changing FocusArea.
3. **TabPrev/TabNext remain internal actions, not default bindings.** Stage `ViewMode::Stacked` and Dock can still cycle through `GlobalAction::TabPrev` / `GlobalAction::TabNext`, but Cmd+I/O is not reserved for tab-group navigation by default.
4. **Split semantics cleaned up.** Cmd+Shift+T and Cmd+Shift+Backslash keep the current-area SplitVertical shortcut. Cmd+Backslash is reserved for Dock visibility.
5. **Removed variants.** `BrowserBack`, `BrowserForward`, `ToggleZoom`, `SplitHorizontalHere`, `SplitVerticalHere` removed from GlobalAction.
6. **Removed bindings.** Cmd+Arrow navigate bindings removed from `default_bindings()`.
7. **Dock-targeting variants.** `DockNavigate(Direction)`, `DockSplitVertical`, `DockSplitHorizontal`, `DockNewTab`, `DockTabPrev`, and `DockTabNext` remain valid internal actions, but only `DockNavigate(Direction)` has a default cross-area keyboard binding.
8. **ToggleZoom renamed to ToggleStacked** in binding (Cmd+Enter maps to `ToggleStacked`). The `ToggleZoom` variant is removed.

Complete binding table (HJKL only, no arrow keys):

| Operation | Current Area (Cmd) | Dock Cross-Area (Cmd+Shift) |
|-----------|-------------------|---------------------------|
| Navigate Up | Cmd+K | Cmd+Shift+K |
| Navigate Down | Cmd+J | Cmd+Shift+J |
| Navigate Left | Cmd+H | Cmd+Shift+H |
| Navigate Right | Cmd+L | Cmd+Shift+L |
| Split Horizontal | None by default | None by default |
| Split Vertical | Cmd+Shift+T, Cmd+Shift+Backslash | None by default |
| New Tab | Cmd+T | None by default |
| Tab Prev | None by default | None by default |
| Tab Next | None by default | None by default |

Unchanged bindings:
- Cmd+[/] = WorkspacePrev/Next
- Cmd+E = ToggleWorkspaceSidebar
- Cmd+B = ToggleFileTree
- Cmd+Backslash = ToggleDock
- Cmd+1/2/3/4 = no default FocusArea or visibility binding
- Cmd+Shift+N/W = NewWorkspace/CloseWorkspace
- Cmd+W = ClosePane
- Cmd+Enter = ToggleStacked (was ToggleZoom, same dispatch)
- Cmd+Shift+O = FileFinder

### Approach

1. **Add new GlobalAction variants.** Add `DockNavigate(Direction)`, `DockSplitVertical`, `DockSplitHorizontal`, `DockNewTab`, `DockTabPrev`, `DockTabNext` to the `GlobalAction` enum, with corresponding `label()`, `action_key()`, and `from_action_key()` entries. Only default-bound actions appear in `all_actions()`.
2. **Remove old variants.** Remove `BrowserBack`, `BrowserForward`, `ToggleZoom`, `SplitHorizontalHere`, `SplitVerticalHere` from `GlobalAction`. Remove all references in `action_key()`, `from_action_key()`, `label()`, `all_actions()`, and `handle_global_action()`.
3. **Update default_bindings().** Remove Cmd+Arrow bindings, Cmd+1/2/3/4 numeric slots, and Cmd+I/O tab-group bindings. Bind Cmd+E to `ToggleWorkspaceSidebar`, Cmd+B to `ToggleFileTree`, Cmd+Backslash to `ToggleDock`, Cmd+Shift+T/Cmd+Shift+Backslash to `SplitVertical`, and Cmd+Shift+H/J/K/L to `DockNavigate`. Map Cmd+Enter to `ToggleStacked`.
4. **Update match_hotkey().** Add Cmd+E for `ToggleWorkspaceSidebar`, make Cmd+Shift+T resolve to `SplitVertical`, add Cmd+Shift modifier branches for HJKL, and remove BrowserBack/Forward plus Cmd+I/O tab-group branches.
5. **Fix Navigate behavior.** In `handle_navigate()`, when FocusArea is Dock, navigate within Dock spatially (do not force focus back to Stage). When FocusArea is Stage, navigate within Stage only.
6. **Fix cycle_tab behavior.** Make `cycle_tab()` FocusArea-aware: when Stage is focused in `ViewMode::Split`, do nothing; when Stage is focused in `ViewMode::Stacked`, cycle Stage split panes; when Dock is focused, cycle Dock tabs.
7. **Add DockNavigate handler.** New handler that always targets Dock navigation without changing FocusArea. When FocusArea is already Dock, behaves identically to Navigate.
8. **Keep Dock split/tab handlers as internal actions.** `DockSplitVertical`/`DockSplitHorizontal` call existing `dock_split_new_tab_group()`. `DockNewTab` creates a new tab in Dock. `DockTabPrev`/`DockTabNext` call `cycle_tab` targeting Dock. They have no default keyboard binding.
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
**Trigger**: User presses Cmd+Shift+H/J/K/L from any FocusArea.
**Precondition**: Dock has at least 2 panes in its layout.

**Flow**:
1. User presses Cmd+Shift+L (DockNavigate Right) while focused in Stage.
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
**Trigger**: System or user override invokes `TabPrev` or `TabNext` while FocusArea is Stage.
**Precondition**: Stage has at least 2 split panes.

**Flow**:
1. `GlobalAction::TabNext` is dispatched while in Stage.
2. `cycle_tab(1)` checks `self.focus.focus_area`.
3. FocusArea is Stage and `ViewMode::Split`: return without changing focus.
4. FocusArea is Stage and `ViewMode::Stacked`: build a flat pane list from the Stage layout.
5. Finds current pane's position, advances to next.
6. Focus moves to the next pane and `focus.zoomed_pane` follows it. FocusArea remains Stage.

**Postcondition**: Focus advances only when Stage is in `ViewMode::Stacked`.

**Business Rules**:
- **BR-1 (Stage split-mode no-op)**: When FocusArea is Stage and `ViewMode::Split` is active, TabPrev/TabNext are no-ops.
- **BR-2 (Dock tab cycling)**: When FocusArea is Dock, TabPrev/TabNext cycle through the focused Stage `Terminal`'s Terminal Context Surface panes.
- **BR-3 (Wrap around)**: Cycling past the last pane wraps to the first, and vice versa.
- **BR-4 (Stage stacked cycling)**: When FocusArea is Stage and `ViewMode::Stacked` is active, TabPrev/TabNext cycle Stage split panes and update `focus.zoomed_pane`.

### UC-4: Cross-Area Dock Tab Cycling

**Actor**: User
**Trigger**: System or user override invokes `DockTabPrev` or `DockTabNext` from any FocusArea.
**Precondition**: Dock has at least 2 tabs.

**Flow**:
1. `GlobalAction::DockTabNext` is dispatched while in Stage.
2. `dock_cycle_tab(1)` cycles through the focused Stage `Terminal`'s Terminal Context Surface panes.
3. Dock's focused pane updates.
4. FocusArea remains Stage.

**Postcondition**: Dock's active tab advances. FocusArea unchanged.

**Business Rules**:
- **BR-1 (No focus area change)**: DockTabPrev/DockTabNext MUST NOT change FocusArea.
- **BR-2 (Opens dock if closed)**: If dock is closed, DockTabPrev/DockTabNext opens it (sets `dock_open = true`), matching current `cycle_tab()` behavior.

### UC-5: Split in Current Area

**Actor**: User
**Trigger**: User invokes SplitVertical or SplitHorizontal through a binding or header action.
**Precondition**: A pane is focused.

**Flow**:
1. User invokes SplitVertical while in Stage.
2. Router matches to `GlobalAction::SplitVertical`.
3. `handle_global_action()` checks FocusArea.
4. If Stage: calls `split_with_launcher(SplitDirection::Vertical)` — splits the focused Stage pane top/bottom.
5. If Dock: calls `dock_split_new_tab_group(SplitDirection::Vertical)` — splits the Dock top/bottom.

**Postcondition**: A new pane is created via split in the current FocusArea.

**Business Rules**:
- **BR-1 (Area-aware split)**: SplitVertical/SplitHorizontal target the current FocusArea. When in Stage they split Stage layout; when in Dock they split Dock layout.
- **BR-2 (Direction semantics)**: SplitHorizontal creates a left/right split. SplitVertical creates a top/bottom split. Cmd+Shift+T and Cmd+Shift+Backslash map to SplitVertical; Cmd+Backslash is reserved for ToggleDock.

### UC-6: Internal Dock Split

**Actor**: User
**Trigger**: Header action, command dispatch, or user override invokes `DockSplitHorizontal` or `DockSplitVertical`.
**Precondition**: Dock is open or will be opened by the action.

**Flow**:
1. A command dispatch invokes `GlobalAction::DockSplitHorizontal` while in Stage.
2. `handle_global_action()` dispatches to `dock_split_new_tab_group(SplitDirection::Horizontal)`.
3. A new dock pane is created. FocusArea remains Stage.

**Postcondition**: Dock gains a new split pane. FocusArea unchanged.

**Business Rules**:
- **BR-1 (Always targets Dock)**: DockSplit variants always target Dock layout regardless of current FocusArea.
- **BR-2 (No focus area change)**: FocusArea is not changed by DockSplit actions.

### UC-7: Internal Dock New Tab

**Actor**: User
**Trigger**: Header action, command dispatch, or user override invokes `DockNewTab`.
**Precondition**: A terminal is focused in Stage (provides dock context).

**Flow**:
1. A command dispatch invokes `GlobalAction::DockNewTab` while in Stage.
2. A new tab is created in the Dock area of the currently focused terminal.
3. FocusArea remains unchanged.

**Postcondition**: Dock gains a new tab. FocusArea unchanged.

**Business Rules**:
- **BR-1 (Always targets Dock)**: DockNewTab creates a tab in the Dock, not in Stage.
- **BR-2 (No focus area change)**: FocusArea is not changed.

### UC-8: Visibility Hotkeys

**Actor**: User
**Trigger**: User presses Cmd+E, Cmd+B, Cmd+Backslash, or Cmd+1/2/3/4.
**Precondition**: App is running.

**Flow**:
1. User presses Cmd+E.
2. Router matches to `GlobalAction::ToggleWorkspaceSidebar`.
3. User presses Cmd+B.
4. Router matches to `GlobalAction::ToggleFileTree`.
5. User presses Cmd+Backslash.
6. Router matches to `GlobalAction::ToggleDock`.
7. User presses Cmd+1/2/3/4.
8. Router does not treat numeric slots as default FocusArea or visibility shortcuts.

**Postcondition**: Visibility hotkeys map to named visibility actions, not positional FocusArea slots.

**Business Rules**:
- **BR-1 (Named toggles)**: Cmd+E maps to ToggleWorkspaceSidebar, Cmd+B maps to ToggleFileTree, and Cmd+Backslash maps to ToggleDock.
- **BR-2 (No numeric shortcuts)**: Cmd+1/2/3/4 are not default FocusArea or visibility bindings.
- **BR-3 (No default tab-group navigation shortcuts)**: Cmd+I/O are not default TabPrev/TabNext bindings.

### UC-10: Keybinding Settings Surface

**Actor**: User
**Trigger**: User opens the config page Keybindings section.
**Precondition**: App is running.

**Flow**:
1. Tide builds the settings action list from `GlobalAction::all_actions()`.
2. Tide omits internal or no-default actions that no longer belong in the default keyboard shortcut surface.
3. Tide shows only actions that have an intentional default shortcut.

**Postcondition**: The Keybindings section does not show obsolete tab-group navigation entries or unbound split entries as `?`.

**Business Rules**:
- **BR-1 (Hide retired tab-group shortcuts)**: `TabPrev`, `TabNext`, `DockTabPrev`, and `DockTabNext` are omitted from the default Keybindings action list.
- **BR-2 (Hide unbound split/tab internals)**: `SplitHorizontal`, `DockSplitHorizontal`, `DockSplitVertical`, and `DockNewTab` are omitted from the default Keybindings action list.
- **BR-3 (No placeholder hotkeys)**: Every action shown by `GlobalAction::all_actions()` must resolve to a default hotkey.

### UC-9: Settings Migration for Removed Actions

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

1. **FocusArea stability**: Cross-area Dock navigation MUST NOT change `self.focus.focus_area`. Only explicit FocusArea actions, visibility toggles, and clicking in a different area change FocusArea.
2. **Modifier orthogonality**: Cmd+H/J/K/L navigates the current FocusArea; Cmd+Shift+H/J/K/L navigates Dock as the supporting context surface without moving FocusArea.
3. **Shift = flip orientation**: Split actions preserve direction semantics. Cmd+Backslash is not a split shortcut; it is reserved for ToggleDock.
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
| UC-5 | BR-2 | `cmd_shift_t_maps_to_split_vertical()` |
| UC-8 | BR-1 | `cmd_backslash_maps_to_toggle_dock()` |
| UC-8 | BR-1 | `cmd_e_maps_to_toggle_workspace_rail()` |
| UC-8 | BR-1 | `cmd_b_maps_to_toggle_file_tree()` |
| UC-8 | BR-2 | `cmd_1_2_3_4_are_not_default_visibility_or_focus_toggles()` |
| UC-8 | BR-3 | `cmd_i_and_cmd_o_are_not_default_tab_group_navigation()` |
| UC-2 | BR-1 | `cmd_shift_hjkl_maps_to_dock_navigate()` |
| UC-5 | BR-2 | `cmd_shift_backslash_maps_to_split_vertical()` |
| UC-6 | BR-1 | `dock_split_vertical_always_targets_dock()` |
| UC-6 | BR-2 | `dock_split_does_not_change_focus_area()` |
| UC-7 | BR-1 | `dock_new_tab_always_targets_dock()` |
| UC-7 | BR-2 | `dock_new_tab_does_not_change_focus_area()` |
| UC-9 | BR-1 | `removed_action_keys_return_none_from_parse()` |
| UC-9 | BR-2 | `toggle_zoom_in_settings_is_silently_dropped()` |
| UC-10 | BR-1/BR-2/BR-3 | `keybinding_settings_omit_retired_tab_group_and_unbound_split_actions()` |

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
