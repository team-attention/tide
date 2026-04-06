# Spec: Global Dock Size & Pinned Panes

## Overview

### As-Is

1. **Dock width is per-terminal**: Each `TerminalPane` stores its own `dock_width: f32`. When switching terminals, the dock width can change. `App.dock_width` exists as a fallback but both are updated together on resize (`mouse.rs:649,652`), making the per-terminal field redundant in practice.

2. **Dock content is per-terminal**: Each `TerminalPane` owns a `dock_layout: SplitLayout` containing its dock panes. When switching terminals, the entire dock content swaps via `swap_dock_state()`. There is no way to keep a pane visible across terminal switches.

3. **No pin concept**: All dock panes belong exclusively to one terminal. Switching terminals replaces the entire dock view.

### To-Be

1. **Global dock width**: A single `App.dock_width` controls the dock size. Split ratios within each terminal's `dock_layout` are already relative (0.0–1.0), so they adapt automatically. No per-terminal width needed.

2. **Pinned panes**: Individual panes (tabs) can be pinned. Pinned panes are visible in the dock regardless of which terminal is focused. They live in a dedicated pinned TabGroup positioned at the leftmost side of the dock.

3. **Dual-existence for owning terminal**: When a pane is pinned and viewed from its owning terminal, it stays in its original position in that terminal's `dock_layout` (no disruption). When viewed from a non-owning terminal, pinned panes appear in the pinned TabGroup on the left.

### Approach

#### Phase 1: Global Dock Width
1. Remove `TerminalPane.dock_width` field
2. Use only `App.dock_width` everywhere
3. Remove `dock_width` from `WorkspaceExtras` (make it truly global, not per-workspace)
4. Update `layout_compute.rs` to use `self.dock_width` directly
5. Update mouse resize handler to only set `App.dock_width`
6. Update session save/restore

#### Phase 2: Pinned Panes
1. Add `App.pinned_panes: Vec<PaneId>` — ordered list of pinned pane IDs
2. Add `App.pinned_dock_ratio: f32` — split ratio between pinned group and terminal content (draggable)
3. Modify dock layout computation to composite: pinned TabGroup (left) + terminal's dock_layout (right)
4. Handle the dual-existence case: when owning terminal is focused, pinned panes stay in their original layout position
5. Add pin/unpin action (GlobalAction::ToggleDockPin)
6. Add drag-and-drop: drag into pinned group = pin, drag out = unpin
7. Add visual indicator (pin icon on tab, separator between pinned and terminal groups)
8. Handle placeholder logic: no placeholder when pinned panes exist

## Bounded Contexts

| Crate | Changes |
|-------|---------|
| `tide-app` | Pin state (`pinned_panes`, `pinned_dock_ratio`), composite dock layout computation, pin/unpin action, drag-and-drop pin toggling, visual indicator rendering, placeholder logic update |
| `tide-input` | New `GlobalAction::ToggleDockPin` |
| `tide-core` | (none expected) |
| `tide-layout` | (none expected — composite layout is computed in tide-app) |

## Use Cases

### UC-1: GlobalDockWidth

**Actor**: User
**Trigger**: User resizes dock border or switches terminal focus
**Precondition**: Dock is open
**Flow**:
1. User drags dock border to resize → `App.dock_width` updates
2. User switches terminal focus → dock width remains the same
3. Split ratios within the terminal's `dock_layout` are relative, so panes resize proportionally within the new/same width

**Postcondition**: Dock width is consistent across all terminal switches within the session

**Business Rules**:
- **BR-1**: Dock width is global — stored only in `App.dock_width`, not per-terminal
- **BR-2**: Switching terminals does not change dock width
- **BR-3**: Split ratios within `dock_layout` adapt proportionally (they are already relative 0.0–1.0)

### UC-2: PinPane

**Actor**: User
**Trigger**: User pins a dock pane (keybinding or drag into pinned group)
**Precondition**: Dock is open, a pane in the dock is focused or being dragged
**Flow**:
1. User triggers pin action on pane P in terminal T's dock
2. P is added to `App.pinned_panes`
3. P remains in T's `dock_layout` (no layout disruption for T)
4. Visual: pin icon appears on P's tab

**Postcondition**: P is marked as pinned

**Business Rules**:
- **BR-1**: Pinning does not move the pane out of the owning terminal's `dock_layout`
- **BR-2**: `associated_terminal` remains unchanged (CWD context preserved)
- **BR-3**: Pinned pane appears in `App.pinned_panes` in insertion order

### UC-3: ViewPinnedFromOtherTerminal

**Actor**: User
**Trigger**: User switches focus to a different terminal
**Precondition**: At least one pane is pinned
**Flow**:
1. User focuses terminal B (different from the pinning terminal T)
2. Dock composites: pinned TabGroup (left) + terminal B's `dock_layout` (right)
3. Pinned TabGroup contains all panes from `App.pinned_panes` that are NOT owned by terminal B
4. If a pinned pane IS owned by terminal B, it appears in its original position in B's `dock_layout` (dual-existence rule)
5. Split between pinned group and terminal content uses `pinned_dock_ratio`

**Postcondition**: User sees pinned panes alongside terminal B's dock content

**Business Rules**:
- **BR-1**: Pinned panes owned by the focused terminal appear in their original `dock_layout` position, not in the pinned group
- **BR-2**: Pinned panes NOT owned by the focused terminal appear in the pinned TabGroup on the left
- **BR-3**: Pinned TabGroup order = insertion order in `App.pinned_panes`
- **BR-4**: If no non-owner pinned panes exist for the focused terminal, the pinned group is hidden (no empty group)

### UC-4: UnpinPane

**Actor**: User
**Trigger**: User unpins a pane (keybinding or drag out of pinned group)
**Precondition**: Pane is pinned
**Flow**:
1. User triggers unpin on pane P
2. P is removed from `App.pinned_panes`
3. P remains in its owning terminal's `dock_layout`
4. If user is viewing from a non-owning terminal, P disappears from the pinned group
5. Pin icon removed from P's tab

**Postcondition**: P is only visible from its owning terminal's dock

**Business Rules**:
- **BR-1**: Unpinned pane stays in owning terminal's `dock_layout`
- **BR-2**: Unpinned pane is no longer visible from other terminals

### UC-5: DragTogglePin

**Actor**: User
**Trigger**: User drags a tab between pinned group and terminal dock area
**Precondition**: Dock is open with both pinned group and terminal content visible
**Flow (pin via drag)**:
1. User drags tab from terminal dock area into pinned group
2. Pane is added to `App.pinned_panes`
3. Pane stays in owning terminal's `dock_layout`

**Flow (unpin via drag)**:
1. User drags tab from pinned group into terminal dock area
2. Pane is removed from `App.pinned_panes`
3. If viewing from owning terminal: pane moves to the drop target position in `dock_layout`
4. If viewing from non-owning terminal: pane moves to the current terminal's `dock_layout` (re-associated) and is unpinned

**Postcondition**: Pin state toggled based on drag direction

**Business Rules**:
- **BR-1**: Drag into pinned group = pin
- **BR-2**: Drag out of pinned group = unpin
- **BR-3**: Drag out from non-owning terminal re-associates pane to current terminal
- **BR-4**: Directional self-drop inside a pinned `TabGroup` extracts the dragged `Pinned Pane` into its own split while preserving pin state

### UC-6: PlaceholderLogic

**Actor**: System
**Trigger**: Terminal focus change or pin/unpin action
**Precondition**: Dock is open
**Flow**:
1. Check if focused terminal's dock has any content (own panes OR visible pinned panes)
2. If yes: no placeholder needed
3. If no dock panes AND no pinned panes: show placeholder Launcher

**Postcondition**: Dock is never visually empty

**Business Rules**:
- **BR-1**: No placeholder when pinned panes exist (even if terminal has no own dock panes)
- **BR-2**: Placeholder Launcher only when both terminal dock and pinned group are empty

## Invariants

1. **Global dock width**: `dock_width` exists only on `App`, never on `TerminalPane` or `WorkspaceExtras`
2. **Pin ownership**: Every pane in `pinned_panes` MUST exist in exactly one terminal's `dock_layout` and in `App.panes`
3. **Pinned pane CWD**: `associated_terminal` for pinned panes is never changed by pin/unpin (CWD context preserved)
4. **No cross-workspace pin**: `pinned_panes` is per-workspace scope (cleared/swapped on workspace switch)
5. **Dual-existence**: A pinned pane appears in its owning terminal's `dock_layout` position when that terminal is focused; in the pinned TabGroup otherwise

## Tests

| UC | BR | Test Function |
|----|-----|---------------|
| UC-1 | BR-1 | `dock_width_is_global_not_per_terminal()` |
| UC-1 | BR-2 | `switching_terminals_preserves_dock_width()` |
| UC-2 | BR-1 | `pinning_pane_does_not_disrupt_owning_terminal_layout()` |
| UC-2 | BR-2 | `pinning_preserves_associated_terminal()` |
| UC-2 | BR-3 | `pinned_panes_ordered_by_insertion()` |
| UC-3 | BR-1 | `pinned_pane_in_original_position_when_owner_focused()` |
| UC-3 | BR-2 | `pinned_pane_in_pinned_group_when_non_owner_focused()` |
| UC-3 | BR-4 | `pinned_group_hidden_when_no_non_owner_pinned_panes()` |
| UC-4 | BR-1 | `unpinned_pane_stays_in_owning_terminal_dock()` |
| UC-4 | BR-2 | `unpinned_pane_not_visible_from_other_terminals()` |
| UC-5 | BR-1 | `drag_into_pinned_group_pins_pane()` |
| UC-5 | BR-2 | `drag_out_of_pinned_group_unpins_pane()` |
| UC-5 | BR-3 | `drag_unpin_from_non_owner_reassociates_terminal()` |
| UC-5 | BR-4 | `directional_self_drop_extracts_pinned_pane_from_pinned_tab_group()` |
| UC-6 | BR-1 | `no_placeholder_when_pinned_panes_exist()` |
| UC-6 | BR-2 | `placeholder_when_no_dock_panes_and_no_pinned()` |

## Location

| Item | Path |
|------|------|
| Pin state fields | `crates/tide-app/src/app.rs` (App struct) |
| Pin/unpin actions | `crates/tide-app/src/application/services/dock_service/` |
| Composite dock layout | `crates/tide-app/src/layout_compute.rs` |
| Pin visual rendering | `crates/tide-app/src/adapter/outward/view/chrome/` |
| GlobalAction variant | `crates/tide-app/src/domain/input/mod.rs` |
| Drag-and-drop pin | `crates/tide-app/src/adapter/inward/mouse_adapter/` |
| Session save/restore | `crates/tide-app/src/application/services/session_service/` |
| Workspace swap | `crates/tide-app/src/application/services/workspace_service/` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/` |
