# Spec: Layout V2 — Stage + Terminal Context Surface

## Overview

### As-Is

Tide uses four product surfaces in one `Tide Window`: Workspace rail, Stage, Terminal Context Surface, and FileTree View. `layout_compute.rs` places Workspace rail on the left, Stage in the main execution area, Terminal Context Surface between Stage and FileTree View, and FileTree View on the outer right.

The legacy `TerminalArea` / `ContextArea` / `DrawerState` language is no longer the user-facing model. Current routing is based on `FocusArea::{FileTree, Stage, Dock}` and current side-surface actions: `ToggleWorkspaceSidebar`, `ToggleDock`, and `ToggleFileTree`.

### To-Be

**Stage** remains the primary execution surface. **Terminal Context Surface** is the Dock region attached to the focused Stage Terminal through the Associated Terminal relationship. **FileTree View** is separate right-side chrome, not a Terminal Context Surface Pane.

```
Workspace rail | Stage | Terminal Context Surface | FileTree View
    Cmd+E       H/J/K/L        Cmd+\                 Cmd+B
```

### Key Design Decisions

1. **TerminalPane owns its Terminal Context Surface panes directly** — no separate DrawerState or global pinned hierarchy.
2. **Terminal Context Surface uses SplitLayout with TabGroup leaves** — reuse existing layout engine.
3. **Stage uses SplitLayout leaves for the primary task surface**.
4. **All keyboard routing is determined by FocusArea first**.
5. **`focused_terminal_id()`** is the single function to resolve which Terminal is active.
6. **Terminal can be a child in Terminal Context Surface** — but child terminals cannot have their own nested context children.

## Domain Model

### Regions

| Region | Visibility | Content | Internal Layout |
|--------|-----------|---------|-----------------|
| Workspace rail | Toggleable (Cmd+E) | Workspace list and task signals | Fixed side surface |
| Stage | Always visible | Primary task Panes, usually Terminal Panes | SplitLayout |
| Terminal Context Surface | Toggleable (Cmd+Backslash) | Editor, Browser, Diff, Launcher, secondary Terminal, or Render Panes bound to focused Terminal | SplitLayout, Leaf(TabGroup) |
| FileTree View | Toggleable (Cmd+B) | File browser rooted at the focused Stage Terminal's working directory | Fixed right-side chrome |

### FileTree Root

FileTree root follows the focused Terminal's working directory:
- Inside a git repo → sticky to the repo root (includes worktrees)
- Outside a git repo → follows CWD directly
- This is "tree root resolution", not "git root following"

### Pane Ownership

```rust
pub struct TerminalPane {
    // ... existing fields ...

/// Panes bound to this terminal, displayed in the Terminal Context Surface.
/// SplitLayout with TabGroup leaves.
pub dock_layout: SplitLayout,

/// Last focused pane in this terminal's Terminal Context Surface.
pub dock_focused: Option<PaneId>,
}
```

- Every non-Stage Pane belongs to exactly one Terminal's `dock_layout`.
- Terminal close → cascade close all panes in `dock_layout`.
- Terminal focus switch → Terminal Context Surface content swaps to new Terminal's `dock_layout`.
- A Terminal can appear as a Pane inside another Terminal's `dock_layout` (e.g., build runner). Such child Terminals have an empty `dock_layout` (no nesting beyond 1 level).

### FocusArea

```rust
enum FocusArea {
    FileTree,
    Stage,
    Dock,       // Terminal Context Surface
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
- **Terminal Context Surface**: Split (TabGroups visible) ↔ Stacked (flatten all TabGroups' tabs, linear navigation). `Cmd+Enter` toggles when Dock has focus; `Cmd+Ctrl+Enter` targets Dock stacked mode without permanently changing FocusArea.
- **Region header ViewMode controls**: The Stage header and Terminal Context Surface header expose separate icon controls. These target their region explicitly rather than relying on the current `FocusArea`.

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

### UC-1: OpenPaneInTerminalContextSurface

- **Trigger**: File click in FileTree, FileFinder, Ctrl+Click URL, or GlobalAction::NewFile
- **Flow**:
  1. `focused_terminal_id()` → owner Terminal
  2. Create Pane, insert into App.panes
  3. Add to owner's `dock_layout`: find first TabGroup leaf → `tab_group.add_tab(new_id)`. If no TabGroup exists, create one.
  4. Set `dock_focused = new_id`
  5. Open Terminal Context Surface if closed
  6. FocusArea = Dock, focused = new_id

### UC-2: SwitchTerminalFocus

- **Trigger**: Click Terminal in Stage or Cmd+H/J/K/L in Stage
- **Flow**:
  1. Set focused = new Terminal
  2. Terminal Context Surface content swaps (new Terminal's dock_layout is now displayed)
  3. If new Terminal's dock_layout is empty → hide Terminal Context Surface
  4. If non-empty → show Terminal Context Surface

### UC-3: ToggleStacked (Cmd+Enter)

- **Stage**: Toggle `terminal_view_mode` between Split and Stacked(focused)
- **Terminal Context Surface**: Toggle between Split (all TabGroups visible) and Stacked (one pane fills Dock)

### UC-4: ToggleDock (Cmd+Backslash)

| State | Action |
|-------|--------|
| Closed + dock empty | Create Launcher in Terminal Context Surface → open |
| Closed + dock has panes | Open + focus |
| Open + Dock focused | Close + focus Stage |
| Open + other focused | Focus Dock |

### UC-5: SplitInStage

- **Trigger**: Cmd+Shift+T while FocusArea = Stage
- Creates new Terminal (via Launcher) in Stage SplitLayout

### UC-6: SplitInDock

- **Trigger**: Cmd+Shift+T while FocusArea = Dock
- If Terminal Context Surface is Split, splits the focused context node in dock_layout and focuses a Launcher
- If Terminal Context Surface is Stacked, preserves Stacked presentation and adds a focused Launcher as the final stacked context tab

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
// Stage
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
    dock_layout: SplitLayout,         // Terminal Context Surface layout
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

1. **Stage is primary task execution**: default Stage creation paths create Terminal Panes directly.
2. **Terminal Context Surface ownership**: Every Pane in a `dock_layout` belongs to exactly one Stage Terminal.
3. **Terminal Context Surface display matches focus**: Dock shows `focused_terminal_id()`'s `dock_layout`.
4. **PaneId sync**: All PaneIds in Stage + all PaneIds across all dock_layouts = App.panes keys
5. **No deep nesting**: A Terminal in a Dock has an empty dock_layout
6. **FocusArea routes everything**: No operation checks pane type to decide routing — only FocusArea

## Current Files

| File | Changes |
|------|---------|
| `crates/tide-app/src/layout_compute.rs` | Computes Workspace rail, Stage, Terminal Context Surface, and FileTree View rects |
| `crates/tide-app/src/application/services/pane_create_service/mod.rs` | Routes Stage and Terminal Context Surface Pane creation |
| `crates/tide-app/src/application/services/dock_service/mod.rs` | Owns Terminal Context Surface split/tab behavior |
| `crates/tide-app/src/application/services/workspace_service/mod.rs` | Handles FocusArea navigation and stacked view cycling |
| `crates/tide-app/src/domain/state/dock.rs` | Stores Dock visibility, width, animation, and legacy pinned compatibility state |
| `crates/tide-app/src/domain/layout/` | Provides SplitLayout and TabGroup behavior |
| `crates/tide-app/src/application/behavior_tests/` | Covers pane lifecycle, input routing, Dock behavior, and layout invariants |
