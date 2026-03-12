# Spec: Workspace

Create, switch, close, and manage Workspaces.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | WorkspaceManager owns the workspace list |
| `tide-layout` | SplitLayout saved/restored via LayoutSnapshot |
| `tide-platform` | IME proxies and WebView frames synced on switch |

## Core Pattern

The active Workspace's state lives directly in App fields (for fast access).
Inactive Workspaces are cold-stored in `WorkspaceManager.workspaces[i]`.

Switching = **save current → update index → load target**.

## Use Cases

### UC-1: SwitchWorkspace

- **Actor**: User
- **Trigger**: GlobalAction::WorkspaceNext (Cmd+]) or GlobalAction::WorkspacePrev (Cmd+[)
- **Precondition**: At least 2 Workspaces exist
- **Flow**:
  1. Hide current WebViews (off-screen)
  2. save_active_workspace() — drain app.panes, snapshot layout into workspace slot
  3. Update ws.active to target index
  4. load_active_workspace() — restore panes, layout, focus from target slot
  5. Clear pane_generations (full invalidation)
  6. compute_layout() for new layout
  7. Restore WebView frames
- **Postcondition**: Target Workspace is active, all its state is in App fields
- **Business Rules**:
  - BR-1: Switching preserves each Workspace's focused Pane
  - BR-2: Switching to the same Workspace is a no-op (no invalidation)
  - BR-3: Switching to out-of-bounds index is a no-op
  - BR-4: WorkspacePrev wraps from first to last
  - BR-5: WorkspaceNext wraps from last to first
  - BR-6: Full pane_generations invalidation on switch (forces complete redraw)

### UC-2: CloseWorkspace

- **Actor**: User
- **Trigger**: GlobalAction::CloseWorkspace
- **Precondition**: Workspace to close is active
- **Flow**:
  1. If only one Workspace exists → no-op
  2. Remove Workspace from list
  3. Switch to adjacent Workspace
- **Postcondition**: Workspace removed, adjacent Workspace active
- **Business Rules**:
  - BR-7: Closing the only Workspace is a no-op
  - BR-8: Closing a Workspace removes it from WorkspaceManager and switches to adjacent

### UC-3: ToggleWorkspaceSidebar

- **Actor**: User
- **Trigger**: GlobalAction::ToggleWorkspaceSidebar
- **Flow**:
  1. Toggle ws.show_sidebar boolean
- **Postcondition**: Sidebar visibility toggled
- **Business Rules**:
  - BR-9: Toggle flips visibility state

### UC-4: MovePaneToWorkspace

- **Actor**: User
- **Trigger**: Drag Pane tab to Workspace sidebar item
- **Precondition**: Source Pane exists, target Workspace differs from current
- **Flow**:
  1. Remove Pane from current layout + panes
  2. save_active_workspace()
  3. Switch to target Workspace
  4. load_active_workspace()
  5. Insert Pane into loaded panes + layout
  6. Focus the dragged Pane
  7. Full invalidation + compute_layout()
- **Postcondition**: Pane moved to target Workspace, which is now active

## Invariants

1. **Only one active**: Exactly one Workspace has its data in App fields; all others in cold storage
2. **No shared PaneIds**: A PaneId belongs to exactly one Workspace
3. **Full invalidation on switch**: All pane_generations cleared to force complete redraw
4. **IME proxy sync**: After load, IME proxies must be recreated for new panes

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1: SwitchWorkspace | BR-1 | `switching_workspace_in_workspace_manager_preserves_each_workspaces_focus` |
| UC-1: SwitchWorkspace | BR-2 | `switching_to_same_workspace_is_a_no_op` |
| UC-1: SwitchWorkspace | BR-3 | `switching_to_out_of_bounds_workspace_is_a_no_op` |
| UC-1: SwitchWorkspace | BR-4 | `workspace_prev_wraps_from_first_to_last` |
| UC-1: SwitchWorkspace | BR-5 | `workspace_next_wraps_from_last_to_first` |
| UC-2: CloseWorkspace | BR-7 | `closing_only_workspace_in_workspace_manager_is_a_no_op` |
| UC-2: CloseWorkspace | BR-8 | `closing_workspace_removes_from_workspace_manager_and_switches` |
| UC-3: ToggleSidebar | BR-9 | `toggling_workspace_sidebar_toggles_visibility` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Orchestrator | tide-app | `workspace.rs`, `app.rs` |
| Layout | tide-layout | `split_layout.rs` (LayoutSnapshot) |
| Tests | tide-app | `behavior_tests.rs :: mod workspace_behavior` |
