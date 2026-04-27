# Spec: Layout V2 — Stage + Dock

## Overview

### As-Is

TerminalArea + ContextArea with DrawerState HashMap. DrawerState uses SplitLayout with single-pane leaves (TabGroup removed). 84+ references to DrawerState, inconsistent routing via owner_terminal() with many edge cases.

### To-Be

**Stage** (terminal splits) + **Dock** (per-terminal tab groups). Dock state lives directly on TerminalPane. No DrawerState HashMap. SplitLayout reintroduces TabGroup for Dock only.

```
(WorkspaceSidebar) | (FileTree) | Stage | (Dock)
     Cmd+E            Cmd+B              Cmd+Backslash
```

### Key Design Decisions

1. **TerminalPane owns its Dock panes directly** — no separate DrawerState or HashMap.
2. **Dock uses SplitLayout with TabGroup leaves** — reuse existing layout engine.
3. **Stage uses SplitLayout with single-PaneId leaves** — no TabGroups.
4. **All routing is determined by FocusArea alone** — no owner_terminal() inference.
5. **`focused_terminal_id()`** is the single function to resolve which Terminal is active.
6. **Terminal can be a child in Dock** — but child terminals cannot have their own Dock children (1 level deep).

## Domain Model

### Regions

| Region | Visibility | Content | Internal Layout |
|--------|-----------|---------|-----------------|
| WorkspaceSidebar | Toggleable (Cmd+E) | Workspace list | Fixed list |
| FileTree | Toggleable (Cmd+B) | File browser | Fixed tree |
| Stage | Always visible | Terminal Panes only | SplitLayout, Leaf(PaneId) |
| Dock | Toggleable (Cmd+Backslash) | Any PaneKind, bound to focused Terminal | SplitLayout, Leaf(TabGroup) |

### FileTree Root

FileTree root follows the focused Terminal's working directory:
- Inside a git repo → sticky to the repo root (includes worktrees)
- Outside a git repo → follows CWD directly
- This is "tree root resolution", not "git root following"

### Pane Ownership

```rust
pub struct TerminalPane {
    // ... existing fields ...

    /// Panes bound to this terminal, displayed in the Dock.
    /// SplitLayout with TabGroup leaves.
    pub dock_layout: SplitLayout,

    /// Last focused pane in this terminal's Dock.
    pub dock_focused: Option<PaneId>,
}
```

- Every non-Stage Pane belongs to exactly one Terminal's `dock_layout`.
- Terminal close → cascade close all panes in `dock_layout`.
- Terminal focus switch → Dock content swaps to new Terminal's `dock_layout`.
- A Terminal can appear as a Pane inside another Terminal's `dock_layout` (e.g., build runner). Such child Terminals have an empty `dock_layout` (no nesting beyond 1 level).

### FocusArea

```rust
enum FocusArea {
    FileTree,
    Stage,      // was TerminalArea
    Dock,       // was ContextArea
}
```

**FocusArea is the sole routing criterion for all operations.**

### Active Terminal Resolution

```rust
fn focused_terminal_id(&self) -> Option<PaneId> {
    let focused = self.focused?;
    // 1. Focused pane is a Terminal in Stage → return it
    if matches!(self.panes.get(&focused), Some(PaneKind::Terminal(_))) {
        if self.layout.pane_ids().contains(&focused) {
            return Some(focused);
        }
    }
    // 2. Focused pane is in a Terminal's dock_layout → return owner
    if let Some(owner) = self.terminal_owning(focused) {
        return Some(owner);
    }
    // 3. Fallback: first Terminal in Stage
    self.layout.pane_ids().into_iter()
        .find(|&id| matches!(self.panes.get(&id), Some(PaneKind::Terminal(_))))
}

fn terminal_owning(&self, pane_id: PaneId) -> Option<PaneId> {
    for (&id, pane) in &self.panes {
        if let PaneKind::Terminal(tp) = pane {
            if tp.dock_layout.pane_ids().contains(&pane_id) {
                return Some(id);
            }
        }
    }
    None
}
```

### ViewMode

```rust
enum ViewMode {
    Split,
    Stacked(PaneId),  // the currently visible pane
}
```

- **Stage**: Split (default) ↔ Stacked. Cmd+Enter toggles.
- **Dock**: Split (TabGroups visible) ↔ Stacked (flatten all TabGroups' tabs, linear navigation). Cmd+Enter toggles.

### Internal TabPrev/TabNext Navigation

When `TabPrev` or `TabNext` is invoked programmatically, Tide builds a **flat traversal order** from the Dock's SplitLayout:
- Visit each TabGroup in layout order (left-to-right, top-to-bottom)
- Within each TabGroup, visit tabs in order
- `TabPrev` = prev in this flat list, `TabNext` = next
- Wraps around at boundaries

`Cmd+I/O` are not default TabGroup navigation bindings.

In **Stage Stacked mode**: cycles through Terminals in layout leaf order.

In **Dock Split mode**: moves within current TabGroup. At edge, jumps to next/prev TabGroup.

In **Dock Stacked mode**: identical flat traversal, just visually shows one pane at a time.

## Use Cases

### UC-1: OpenPaneInDock

- **Trigger**: File click in FileTree, FileFinder, Ctrl+Click URL, or GlobalAction::NewFile
- **Flow**:
  1. `focused_terminal_id()` → owner Terminal
  2. Create Pane, insert into App.panes
  3. Add to owner's `dock_layout`: find first TabGroup leaf → `tab_group.add_tab(new_id)`. If no TabGroup exists, create one.
  4. Set `dock_focused = new_id`
  5. Open Dock if closed
  6. FocusArea = Dock, focused = new_id

### UC-2: SwitchTerminalFocus

- **Trigger**: Click Terminal in Stage or Cmd+H/J/K/L in Stage
- **Flow**:
  1. Set focused = new Terminal
  2. Dock content swaps (new Terminal's dock_layout is now displayed)
  3. If new Terminal's dock_layout is empty → hide Dock
  4. If non-empty → show Dock

### UC-3: ToggleStacked (Cmd+Enter)

- **Stage**: Toggle `terminal_view_mode` between Split and Stacked(focused)
- **Dock**: Toggle between Split (all TabGroups visible) and Stacked (one pane fills Dock)

### UC-4: ToggleDock (Cmd+Backslash)

| State | Action |
|-------|--------|
| Closed + dock empty | Create Launcher in dock → open |
| Closed + dock has panes | Open + focus |
| Open + Dock focused | Close + focus Stage |
| Open + other focused | Focus Dock |

### UC-5: SplitInStage

- **Trigger**: Cmd+Shift+T while FocusArea = Stage
- Creates new Terminal (via Launcher) in Stage SplitLayout

### UC-6: SplitInDock

- **Trigger**: Cmd+Shift+T while FocusArea = Dock
- Splits the focused TabGroup's node in dock_layout
- New leaf gets a new TabGroup with a Launcher

### UC-7: CloseTerminalCascade

- Close Terminal from Stage
- All panes in its dock_layout are cascade-closed
- Dock swaps to next Terminal's content

### UC-8: ClosePaneInDock

- Cmd+W in Dock
- Remove pane from its TabGroup
- If TabGroup empty → remove TabGroup from dock_layout
- If dock_layout empty → close Dock, focus owner Terminal

### UC-9: NavigateBetweenRegions

- Cmd+H/L at region boundary → cross into adjacent region
- Skips hidden regions

## Data Model

```rust
// Stage (TerminalArea)
App {
    layout: SplitLayout,             // Leaf(PaneId), Terminal-only
    terminal_view_mode: ViewMode,

    // Dock visibility + sizing (shared across all terminals)
    dock_open: bool,
    dock_width: f32,

    // Existing
    panes: HashMap<PaneId, PaneKind>,
    focused: Option<PaneId>,
    focus_area: FocusArea,
}

// Per-terminal Dock state lives on TerminalPane
TerminalPane {
    // ... existing PTY fields ...
    dock_layout: SplitLayout,         // Leaf(TabGroup), any PaneKind
    dock_focused: Option<PaneId>,
}

// SplitLayout Node (reintroduce TabGroup option)
enum Node {
    Leaf(PaneId),       // used in Stage
    LeafGroup(TabGroup), // used in Dock
    Split { direction, ratio, left, right },
}
```

## Invariants

1. **Stage is Terminal-only**: Only Terminal and Launcher (resolving to Terminal) in Stage SplitLayout
2. **Dock ownership**: Every pane in a dock_layout belongs to exactly one Terminal
3. **Dock display matches focus**: Dock always shows `focused_terminal_id()`'s dock_layout
4. **PaneId sync**: All PaneIds in Stage + all PaneIds across all dock_layouts = App.panes keys
5. **No deep nesting**: A Terminal in a Dock has an empty dock_layout
6. **FocusArea routes everything**: No operation checks pane type to decide routing — only FocusArea

## Migration from Current Code

1. Remove `DrawerState` struct and `drawer_states: HashMap` from App
2. Remove `context_area_open` → rename to `dock_open`
3. Remove `context_area_width` → rename to `dock_width`
4. Add `dock_layout: SplitLayout` and `dock_focused: Option<PaneId>` to TerminalPane
5. Reintroduce TabGroup to SplitLayout Node (as `LeafGroup` variant, distinct from `Leaf`)
6. Remove `owner_terminal()` → replace with `focused_terminal_id()` + `terminal_owning()`
7. Remove `swap_drawer_state()` → Dock content swap is implicit (read from focused Terminal's dock_layout)
8. Remove `add_pane_to_context_area()` → direct manipulation of TerminalPane.dock_layout
9. Remove `remove_pane_from_context_area()` → direct manipulation
10. Remove `toggle_context_area()` → replace with `toggle_dock()`
11. Update all `FocusArea::TerminalArea` → `FocusArea::Stage`
12. Update all `FocusArea::ContextArea` → `FocusArea::Dock`
13. Rename in glossary: TerminalArea→Stage, ContextArea→Dock

## Affected Files

| File | Changes |
|------|---------|
| `ui_state.rs` | Remove DrawerState, ViewMode stays, FocusArea rename |
| `main.rs` | Remove drawer_states/context_area_*, add dock_open/dock_width |
| `pane.rs` | Add dock_layout/dock_focused to TerminalPane |
| `action/drawer.rs` | Rewrite entirely → `action/dock.rs` |
| `action/mod.rs` | Update all routing to use FocusArea + focused_terminal_id() |
| `action/pane_lifecycle.rs` | Route pane creation to dock_layout |
| `action/focus_nav.rs` | Update navigation, remove is_pane_in_drawer |
| `layout_compute.rs` | Compute Dock rects from focused Terminal's dock_layout |
| `rendering/chrome.rs` | Dock separator, owner highlight |
| `workspace.rs` | dock_layout saved/restored with Terminal |
| `session.rs` | dock_layout serialized with Terminal |
| `tide-layout/node.rs` | Add Node::LeafGroup(TabGroup) |
| `tide-layout/lib.rs` | Re-export TabGroup, add LeafGroup methods |
| `behavior_tests.rs` | Update all drawer tests |
