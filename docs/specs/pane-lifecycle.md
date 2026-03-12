# Spec: Pane Lifecycle

Create, split, resolve, open, close, and drag Panes.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Orchestrates lifecycle, maintains panes HashMap |
| `tide-layout` | Manages SplitLayout binary tree and TabGroups |
| `tide-terminal` | Creates PTY for Terminal panes |
| `tide-editor` | Creates EditorState buffer for Editor panes |

## Use Cases

### UC-1: CreateTab

- **Actor**: User
- **Trigger**: GlobalAction::NewTab (Cmd+T)
- **Precondition**: A Pane is focused
- **Flow**:
  1. Allocate PaneId via layout.alloc_id()
  2. Create Launcher(new_id)
  3. Insert into app.panes HashMap
  4. layout.add_tab(focused_id, new_id) — same TabGroup
  5. Set focused = new_id
  6. invalidate_chrome()
- **Postcondition**: New Launcher tab added to focused Pane's TabGroup, focused
- **Business Rules**:
  - BR-1: New tab is always a Launcher (not Terminal directly)
  - BR-2: If no Pane is focused, do nothing
  - BR-3: Focus moves to the newly created Pane

### UC-2: SplitPane

- **Actor**: User
- **Trigger**: GlobalAction::SplitVertical (Cmd+Shift+T) or GlobalAction::SplitHorizontal
- **Precondition**: A Pane is focused
- **Flow**:
  1. Unzoom if zoomed
  2. new_id = layout.split(focused_id, direction)
     - Binary tree transformation: Leaf → Split { left: original, right: new_leaf }
  3. Create Launcher(new_id)
  4. Insert into app.panes HashMap
  5. Set focused = new_id
  6. invalidate_chrome()
- **Postcondition**: New Launcher in a new SplitLayout node, focused
- **Business Rules**:
  - BR-4: Split always creates a Launcher (not Terminal directly)
  - BR-5: If Pane was zoomed, unzoom before splitting
  - BR-6: Focus moves to the newly created Pane

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
  1. Check if file is already open in any tab
  2. If YES → set_active_tab(existing_id), focus it, return
  3. If NO → allocate PaneId, create EditorState::open(path)
  4. Insert into app.panes
  5. layout.add_tab(focused_id, new_id)
  6. Set focused = new_id
  7. Start file watcher on path
- **Postcondition**: File visible in an Editor Pane, focused
- **Business Rules**:
  - BR-8: Opening an already-open file activates the existing tab (dedup)
  - BR-9: Focus moves to the opened file's Pane

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
  - BR-13: App always has at least one Pane (create Launcher if last one closed)
  - BR-14: Cancel on SaveConfirm clears the modal without closing

### UC-6: DragDropPane

- **Actor**: User
- **Trigger**: Mouse down on tab bar + drag beyond threshold
- **Precondition**: Source Pane exists in a TabGroup
- **Flow**:
  1. Mouse down → PaneDragState::PendingDrag { source, press_pos }
  2. Mouse moves beyond threshold → PaneDragState::Dragging { source, drop_target }
  3. Mouse over pane → compute DropZone (Top/Bottom/Left/Right/Center)
  4. Mouse over workspace sidebar → highlight Workspace
  5. Mouse released:
     - On pane DropZone → layout.move_pane(source, target, zone)
     - On Workspace sidebar → move_pane_to_workspace(source, ws_idx)
     - On root DropZone → layout.move_pane_to_root(source, zone)
  6. Mouse released before threshold → just a click (focus tab)
- **Postcondition**: Pane moved to new position in SplitLayout or to another Workspace
- **Business Rules**:
  - BR-15: Mouse release before threshold is a tab focus click, not a drop

## Invariants

After ANY Pane lifecycle operation:

1. **PaneId sync**: Every id in `layout.pane_ids()` exists in `app.panes`, and vice versa
2. **Focus valid**: `app.focused` is either `None` or a valid key in `app.panes`
3. **At least one Pane**: App always has at least one Pane (Launcher if needed)

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1: CreateTab | BR-1 | `new_terminal_tab_creates_launcher_pane` |
| UC-1: CreateTab | BR-2 | `new_editor_pane_does_nothing_without_focus` |
| UC-1: CreateTab | BR-3 | `new_editor_pane_sets_focus_to_new_pane` |
| UC-1: CreateTab | — | `new_editor_pane_adds_to_focused_tab_group` |
| UC-2: SplitPane | BR-4 | `split_focuses_new_launcher_pane` |
| UC-2: SplitPane | BR-5 | `split_unzooms_focused_pane` |
| UC-2: SplitPane | — | `split_creates_new_pane_in_split_layout` |
| UC-3: ResolveLauncher | BR-7 | `resolving_launcher_as_new_file_replaces_pane_kind_with_editor` |
| UC-4: OpenFile | BR-8 | `opening_same_file_twice_activates_existing_tab_instead` |
| UC-5: ClosePane | BR-10 | `closing_a_dirty_editor_with_file_shows_save_confirm` |
| UC-5: ClosePane | BR-11 | `closing_a_dirty_untitled_editor_does_not_show_save_confirm` |
| UC-5: ClosePane | BR-12 | `closing_editor_pane_moves_focus_to_another_pane` |
| UC-5: ClosePane | BR-12 | `closing_tab_in_right_group_focuses_same_group_not_left` |
| UC-5: ClosePane | BR-12a | `closing_only_tab_in_group_focuses_neighbor_group` |
| UC-5: ClosePane | BR-14 | `cancel_save_confirm_clears_the_modal` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Orchestrator | tide-app | `action/pane_lifecycle.rs`, `pane.rs` |
| Layout | tide-layout | `split_layout.rs`, `tab_group.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod pane_lifecycle` |
