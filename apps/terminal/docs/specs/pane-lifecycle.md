# Spec: Pane Lifecycle

Create, split, resolve, open, close, and drag Panes.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Orchestrates lifecycle, maintains panes HashMap |
| `tide-layout` | Manages SplitLayout binary tree and TabGroups |
| `tide-terminal` | Creates PTY for Terminal panes |
| `tide-editor` | Creates EditorState buffer for Editor Panes |

## Use Cases

### UC-1: CreateTab

- **Actor**: User
- **Trigger**: GlobalAction::NewTab (Cmd+T)
- **Precondition**: A Pane is focused
- **Flow**:
  1. Allocate PaneId via layout.alloc_id()
  2. If FocusArea is Stage, create a `Terminal` and insert it as a right-side split leaf next to the focused Stage Pane
  3. If FocusArea is Dock, create a `Launcher` in a Terminal Context Surface split
  4. Insert into app.panes HashMap
  5. Set focused = new_id
  6. invalidate_chrome()
- **Postcondition**: New Pane is focused in the target area
- **Business Rules**:
  - BR-1: New tab in Stage creates a right-side Terminal split leaf through `SplitDirection::Vertical`; new tab in Dock creates a Launcher split in the Terminal Context Surface
  - BR-2: If no Pane is focused, do nothing
  - BR-3: Focus moves to the newly created Pane
  - BR-3a: A newly created Stage `Terminal` defaults its Terminal Context Surface to Stacked view.

### UC-2: SplitPane

- **Actor**: User
- **Trigger**: GlobalAction::SplitHorizontal (Cmd+Shift+T) or GlobalAction::SplitVertical
- **Precondition**: A Pane is focused
- **Flow**:
  1. If the focused Stage Pane is zoomed, keep stacked mode active while creating the new Stage Pane
  2. In Stage, create a split leaf with `new_id = layout.split(focused_id, direction)`
  3. In Dock, create a context split in the owning Stage `Terminal`'s Terminal Context Surface
  4. Create the new Pane for the target area
  5. Insert into `app.panes`
  6. Set focused = new_id
  7. invalidate_chrome()
- **Postcondition**: The new Pane is focused. Stage and Dock split actions create a new `SplitLayout` leaf in their target area.
- **Business Rules**:
  - BR-4: Split in Stage creates a Terminal directly; split in Dock creates a Launcher in a Terminal Context Surface split
  - BR-4a: `SplitVertical` creates a left/right split; `SplitHorizontal` creates a top/bottom split.
  - BR-5: If the focused Stage Pane was zoomed, split preserves stacked mode and focuses the new Stage Pane so the stacked flat tab bar stays visible
  - BR-6: Focus moves to the newly created Pane
  - BR-7: If the focused Stage Pane is zoomed, split keeps stacked mode and creates a new Stage split leaf selected by `focus.zoomed_pane`

### UC-3: ResolveLauncher

- **Actor**: User
- **Trigger**: User presses T/E/O/B in Launcher
- **Precondition**: Focused Pane is a Launcher
- **Flow**:
  1. Match LauncherChoice:
     - Terminal → spawn PTY, replace PaneKind::Launcher with PaneKind::Terminal
     - NewFile → create empty EditorState, replace with PaneKind::Editor
     - OpenFile → open FileFinder modal, user picks file → PaneKind::Editor
     - Browser → create WebView, replace with PaneKind::Browser
- **Postcondition**: Launcher replaced by concrete PaneKind in-place (same PaneId)
- **Business Rules**:
  - BR-7: Launcher is replaced in-place — PaneId does not change

### UC-4: OpenFile

- **Actor**: User
- **Trigger**: Select file in FileTree or FileFinder
- **Precondition**: File path is valid
- **Flow**:
  1. Resolve the current open target: the live owning Terminal Context Surface, or Stage fallback
  2. Check if file is already open in that open target
  3. If YES → set_active_tab(existing_id), focus it, return
  4. If NO → allocate PaneId, create EditorState::open(path)
  5. Insert into app.panes
  6. Insert the new Editor Pane as a split to the right of the focused Pane or focused context Pane
  7. Set focused = new_id
  8. Start file watcher on path
- **Postcondition**: File visible in an Editor Pane, focused
- **Business Rules**:
  - BR-8: Opening an already-open file activates an existing tab only when it is already open in the current open target
  - BR-8a: A matching file in another Stage Terminal's Terminal Context Surface must not satisfy dedup; opening keeps the current Stage Terminal and creates an Editor Pane in its Terminal Context Surface
  - BR-9: Focus moves to the opened file's Pane
  - BR-9a: Opening a new file defaults to a right-side split when it creates a new split in Stage fallback or Terminal Context Surface

### UC-5: ClosePane

- **Actor**: User
- **Trigger**: GlobalAction::ClosePane (Cmd+W)
- **Precondition**: A Pane is targeted for close
- **Flow**:
  1. If Editor + dirty + has file_path → show SaveConfirm modal, return
  2. If Editor + dirty + no file_path (untitled) → close immediately
  3. Remove from app.panes HashMap
  4. layout.remove(id) — remove from TabGroup, collapse empty splits
  5. Remove file watcher
  6. Remove IME proxy
  7. If panes remain → focus adjacent pane
  8. If no panes remain and last Workspace → create Launcher
  9. If no panes remain and other Workspaces exist → close Workspace, switch to adjacent
- **Postcondition**: Pane removed or SaveConfirm modal shown
- **Business Rules**:
  - BR-10: Dirty Editor with file_path → show SaveConfirm modal (don't close)
  - BR-11: Dirty Editor without file_path (untitled) → close immediately (no prompt)
  - BR-12: After close, focus stays in the same TabGroup (next tab, or previous if last)
  - BR-12a: If the closed tab was the only tab in its TabGroup, focus moves to a layout neighbor
  - BR-12b: In Stage `ViewMode::Stacked`, closing the focused `Pane` moves focus to the immediately previous `Pane` in the flat stacked tab order; if there is no previous `Pane`, focus moves to the immediately next `Pane`.
  - BR-12c: In Stage `ViewMode::Split`, closing the focused `Pane` prefers the immediate right layout neighbor; if no right neighbor exists, focus moves to the immediately previous `Pane` in flat layout order.
  - BR-12d: Closing a non-focused Stage `Pane` must not steal focus from the currently focused Stage `Pane`.
  - BR-13: App always has at least one Pane (create Launcher if last one closed)
  - BR-14: Cancel on SaveConfirm clears the modal without closing
  - BR-15: Browser Pane native teardown must complete on the main thread before Browser Pane state is dropped, so `MainThreadOnly` WebKit/AppKit objects are not released on `app-thread`
  - BR-16: Closing a Browser Pane must resolve any pending native permission or certificate handler with a deny/cancel decision before the Browser Pane native view is released

### UC-6: DragDropPane

- **Actor**: User
- **Trigger**: Mouse down on tab bar + drag beyond threshold
- **Precondition**: Source Pane exists in a TabGroup
- **Flow**:
  1. Mouse down on a Dock tab or Stage tab → `PaneDragState::PendingDrag { source, press_pos }`
  2. Mouse moves beyond threshold → PaneDragState::Dragging { source, drop_target }
  3. Mouse over pane → compute DropZone (Top/Bottom/Left/Right/Center)
  4. Mouse over Workspace rail → highlight Workspace
  5. Mouse released:
     - clear the current hover target immediately
     - On pane DropZone → layout.move_pane(source, target, zone)
     - On Workspace rail → move_pane_to_workspace(source, ws_idx)
     - On root DropZone → layout.move_pane_to_root(source, zone)
  6. Mouse released before threshold → just a click (focus tab)
- **Postcondition**: Pane moved to new position in SplitLayout or to another Workspace
- **Business Rules**:
  - BR-15: Mouse release before threshold is a tab focus click, not a drop
  - BR-16: Pressing a Stage tab starts the same pending-drag lifecycle as pressing a Dock tab
  - BR-17: Directional self-drop is allowed only when the source Pane belongs to a multi-tab `TabGroup`, so a single tab may be extracted into a new split
  - BR-18: A Stage Pane may move within Stage or to another `Workspace`, but never into Dock targets
  - BR-19: Mouse release clears the current hover target immediately so hover visuals do not wait for the next mouse move
  - BR-20: Mouse release still completes border-drag and pane-drag cleanup before returning
  - BR-21: Mouse down recomputes the current hover target from cursor position before dispatching titlebar surface buttons, so a button can be clicked again without an intervening mouse move
  - BR-22: FileTree View and Terminal Context Surface border drags must use the same widened border hit slop for hover and mouse-down acquisition.

## Invariants

After ANY Pane lifecycle operation:

1. **PaneId sync**: Every id in `layout.pane_ids()` exists in `app.panes`, and vice versa
2. **Focus valid**: `app.focused` is either `None` or a valid key in `app.panes`
3. **At least one Pane**: App always has at least one Pane (Launcher if needed)
4. **Browser Pane teardown**: Closing a Browser Pane must tear down its native view on the main thread before removal from `app.panes`, so native `MainThreadOnly` resources are not dropped on `app-thread`
5. **Pending native handler safety**: Closing a Browser Pane must not leave a pending native permission or certificate handler unreconciled during teardown

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1: CreateTab | BR-1 | `new_terminal_tab_creates_launcher_pane` |
| UC-1: CreateTab | BR-2 | `new_editor_pane_does_nothing_without_focus` |
| UC-1: CreateTab | BR-3 | `new_editor_pane_sets_focus_to_new_pane` |
| UC-1: CreateTab | BR-3a | `new_stage_terminal_defaults_terminal_context_surface_to_stacked_mode` |
| UC-1: CreateTab | — | `new_editor_pane_adds_stage_split_leaf` |
| UC-2: SplitPane | BR-4 | `split_focuses_new_terminal_pane_in_stage` |
| UC-2: SplitPane | BR-5 | `splitting_zoomed_stage_leaf_keeps_stacked_mode_and_focuses_the_new_pane` |
| UC-2: SplitPane | BR-7 | `splitting_stacked_stage_creates_split_leaf_not_tab_group` |
| UC-2: SplitPane | — | `split_creates_new_pane_in_split_layout` |
| UC-3: ResolveLauncher | BR-7 | `resolving_launcher_as_new_file_replaces_pane_kind_with_editor` |
| UC-4: OpenFile | BR-8 | `opening_same_file_twice_activates_existing_tab_instead` |
| UC-4: OpenFile | BR-8a | `opening_same_file_from_another_stage_terminal_keeps_current_terminal_context` |
| UC-4: OpenFile | BR-9a | `opening_file_defaults_to_right_split_when_focused_is_non_terminal` |
| UC-4: OpenFile | BR-9a | `opening_file_in_context_surface_defaults_to_right_split` |
| UC-5: ClosePane | BR-10 | `closing_a_dirty_editor_with_file_shows_save_confirm` |
| UC-5: ClosePane | BR-11 | `closing_a_dirty_untitled_editor_does_not_show_save_confirm` |
| UC-5: ClosePane | BR-12 | `closing_editor_pane_moves_focus_to_another_pane` |
| UC-5: ClosePane | BR-12 | `closing_tab_in_right_group_focuses_same_group_not_left` |
| UC-5: ClosePane | BR-12a | `closing_only_tab_in_group_focuses_neighbor_group` |
| UC-5: ClosePane | BR-12c | `closing_rightmost_split_pane_focuses_immediate_left_neighbor` |
| UC-5: ClosePane | BR-12d | `closing_unfocused_stage_terminal_preserves_current_focus` |
| UC-5: ClosePane | BR-14 | `cancel_save_confirm_clears_the_modal` |
| UC-5: ClosePane | BR-15 | `closing_browser_pane_moves_focus_to_another_pane` |
| UC-5: ClosePane | BR-16 | `closing_browser_pane_with_pending_certificate_error_preserves_pane_lifecycle_invariants` |
| UC-6: DragDropPane | BR-16 | `tab_prev_next_in_stacked_stage_cycles_split_panes` |
| UC-6: DragDropPane | BR-17 | `stage_self_drop_has_no_drop_target_or_preview` |
| UC-6: DragDropPane | BR-18 | `stage_pane_drop_target_never_enters_dock` |
| UC-6: DragDropPane | BR-19 | `mouse_release_clears_hover_target_immediately` |
| UC-6: DragDropPane | BR-20 | `mouse_release_still_completes_border_drag_cleanup` |
| UC-6: DragDropPane | BR-21 | `titlebar_surface_buttons_recompute_hover_target_on_mouse_down` |
| UC-6: DragDropPane | BR-22 | `file_tree_border_drag_uses_widened_hit_slop` |
| UC-6: DragDropPane | BR-22 | `dock_border_drag_uses_widened_hit_slop` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Inward adapter | tide-app | `crates/tide-app/src/adapter/inward/click_adapter/header.rs`, `crates/tide-app/src/adapter/inward/click_adapter/pane.rs` |
| Layout | tide-app | `crates/tide-app/src/domain/layout/mod.rs`, `crates/tide-app/src/domain/layout/node.rs`, `crates/tide-app/src/domain/layout/tab_group.rs` |
| Tests | tide-app | `crates/tide-app/src/application/behavior_tests/pane_lifecycle.rs`, `crates/tide-app/src/application/behavior_tests/stage_split_only.rs`, `crates/tide-app/src/application/behavior_tests/dock_behavior.rs` |
