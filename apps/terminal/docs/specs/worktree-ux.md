# Spec: Worktree UX

Synthesize research findings from VS Code, Codex CLI, Zellij, tmux-sessionizer, and JetBrains into concrete Tide improvements for Workspace discovery, identity, and git worktree integration.

## Overview

### As-Is

Tide's Workspace system provides create (Cmd+Shift+N), switch (Cmd+[/]), close (Cmd+Shift+W), and Workspace rail toggle (Cmd+E). The underlying machinery is sound: WorkspaceManager hot/cold swaps layout, panes, focus, and extras via `save_active_workspace`/`load_active_workspace` (see `application/services/workspace_infra_service/mod.rs`).

**Problems:**

1. **Generic naming.** `new_workspace()` assigns `"Workspace N"` (line 197 of workspace_infra_service). There is no auto-detection of git branch, directory name, or worktree. Users must mentally track which number maps to which task.

2. **No fuzzy picker.** The only way to reach a Workspace is sequential Cmd+[/] cycling or clicking the Workspace rail. With 5+ Workspaces this is slow. Every researched tool (Zellij, tmux-sessionizer, VS Code Ctrl+R, JetBrains project widget) provides a single-keystroke fuzzy picker.

3. **No visual identity.** All Workspaces look similar. There is no strong color coding, branch name, or persistent indicator of which Workspace is active beyond the Workspace rail.

4. **GitSwitcher is disconnected from Workspace.** `GitSwitcherState` (in `domain/modal/mod.rs` line 266) operates on branches and worktrees within a single terminal Pane. Its "New Pane" action opens a terminal in the *current* Workspace. Creating a git worktree does not create a corresponding Workspace, and vice versa. Users who adopt a one-worktree-per-task workflow must manually create both.

5. **Workspace rail has limited hierarchy.** Inactive Workspaces show less context than the active Workspace. Branch, Pane count, change state, and richer task-status signals are still roadmap work.

### To-Be

1. **Workspace Fuzzy Picker** — A ModalStack popup (like FileFinder) activated by a single GlobalAction. Fuzzy-matches Workspace name, git branch, and CWD. Selecting a match switches to that Workspace. Typing a non-matching name offers to create a new Workspace with that name. This is the "create-on-switch" pattern universal across tmux-sessionizer, Zellij session manager, and VS Code Ctrl+R.

2. **Auto-naming** — `new_workspace()` derives the name from the git branch of the initial terminal's CWD (e.g., `feature/auth` becomes `feature/auth`), or from the directory basename if not in a git repo. Falls back to `"Workspace N"` only when detection fails. Users can rename at any time.

3. **Color-as-identity** — Each Workspace gets an accent color from a fixed palette (8-10 colors, assigned round-robin by creation order). The color appears as: (a) a dot/stripe in the Workspace rail item, (b) the title bar Workspace indicator, and (c) the focused Pane border tint. Inspired by VS Code Peacock, but built-in and automatic.

4. **GitSwitcher-Workspace integration** — When the user selects "New Pane" on a worktree in GitSwitcherState's Worktrees tab, Tide offers an option to open it in a new Workspace (not just a new Pane in the current one). This bridges the gap: one worktree = one Workspace becomes a natural flow. The new Workspace auto-names from the worktree branch.

5. **Richer Workspace rail** — All Workspace rail items show: name (with color dot), git branch (if detectable), Pane count, and useful task status. CWD is shown for all Workspaces when it can be derived from cold-stored terminal contexts, not just the active one.

6. **Persistent Workspace indicator** — The titlebar always shows the active Workspace name + color dot, replacing the current "Tide . N" format. This is the "where am I" signal (analogous to VS Code's remote indicator or JetBrains' project widget).

### Approach

The changes are ordered by dependency. Each step is independently shippable.

**Step 1: Auto-naming**
- Modify `new_workspace()` to detect the git branch (via existing `git rev-parse --abbrev-ref HEAD` in the CWD) or directory basename.
- Add a `rename_workspace(idx, name)` method to WorkspaceManager for manual override.
- Store the name source (`Auto` vs `Manual`) in Workspace so auto-names can be refreshed on branch change.

**Step 2: Richer Workspace rail**
- Add `branch: Option<String>` and `pane_count: usize` fields to Workspace (or derive them on demand).
- For cold-stored Workspaces, iterate `workspace.panes` to count, and check stored TerminalContext for branch/CWD.
- Update Workspace rail rendering to display branch + count for all items.

**Step 3: Color-as-identity**
- Add `color_index: u8` to Workspace. Assigned sequentially mod palette size on creation.
- Define a `WORKSPACE_PALETTE: [Color; 8]` constant in `theme.rs`.
- Render a color dot in Workspace rail items and the titlebar indicator.
- Tint the focused Pane border with the Workspace color at low opacity.

**Step 4: Persistent Workspace indicator**
- Replace "Tide . N" in titlebar with `"{workspace_name}"` plus the color dot.
- Always visible regardless of Workspace rail state.

**Step 5: Workspace Fuzzy Picker**
- Add `WorkspacePicker` to ModalStack (new modal type, similar to FileFinder).
- Add `GlobalAction::OpenWorkspacePicker`. No default keybinding is chosen in this spec.
- Picker shows all Workspaces with name, branch, CWD.
- Fuzzy filter on all three fields.
- Enter on a match calls `switch_workspace(idx)`.
- Enter on non-match offers "Create Workspace '{input}'" which calls `new_workspace()` with the typed name.
- Esc closes the picker.

**Step 6: GitSwitcher-Workspace integration**
- In the Worktrees tab of GitSwitcherState, add a "New Workspace" action (alongside existing "New Pane").
- "New Workspace" calls `new_workspace()`, sets CWD to the worktree path, and auto-names from the worktree branch.
- Add keybinding hint in the GitSwitcher hint bar.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/input/` | New GlobalAction variants (OpenWorkspacePicker, RenameWorkspace) |
| `domain/modal/` | New WorkspacePickerState modal type |
| `domain/state/workspace_mgr.rs` | WorkspaceManager: color_index, name_source fields |
| `application/services/workspace_infra_service/` | Auto-naming logic, rename method, picker create-on-switch |
| `adapter/outward/view/chrome/titlebar.rs` | Richer Workspace rail rendering, persistent indicator |
| `adapter/outward/view/overlays/` | WorkspacePicker overlay rendering |
| `adapter/inward/keyboard_adapter/` | Picker input handling, GitSwitcher new-workspace action |
| `theme.rs` | WORKSPACE_PALETTE constant |

## Use Cases

### UC-1: OpenWorkspacePicker

- **Actor**: User
- **Trigger**: GlobalAction::OpenWorkspacePicker
- **Precondition**: No modal currently open (ModalStack exclusivity)
- **Flow**:
  1. Open WorkspacePickerState modal with all Workspaces listed
  2. User types to fuzzy-filter by name, branch, or CWD
  3. User selects a Workspace with arrow keys + Enter
  4. Close picker, call `switch_workspace(selected_idx)`
- **Postcondition**: Target Workspace is active
- **Business Rules**:
  - BR-1: Fuzzy matching applies to name, branch, and CWD simultaneously
  - BR-2: Current Workspace is highlighted but selectable (selecting it is a no-op switch)
  - BR-3: Empty input shows all Workspaces sorted by recency (active first, then reverse creation order)
  - BR-4: Esc closes picker without switching

### UC-2: CreateWorkspaceFromPicker

- **Actor**: User
- **Trigger**: User types a name that matches no existing Workspace and presses Enter
- **Precondition**: WorkspacePickerState is open, no Workspace matches the input
- **Flow**:
  1. Show a "Create Workspace '{input}'" row at the bottom of the list
  2. User selects it and presses Enter
  3. Call `new_workspace()` with the typed name as a manual name
  4. Close picker
- **Postcondition**: New Workspace created with the typed name, now active
- **Business Rules**:
  - BR-5: The create row appears only when no exact name match exists
  - BR-6: The new Workspace is named exactly as typed (Manual name source)

### UC-3: AutoNameWorkspace

- **Actor**: System
- **Trigger**: `new_workspace()` is called (from Cmd+Shift+N, picker, or GitSwitcher)
- **Precondition**: No explicit name provided
- **Flow**:
  1. Detect git branch from the initial terminal's CWD via `git rev-parse --abbrev-ref HEAD`
  2. If detected, use branch name as Workspace name (e.g., `feature/auth`)
  3. If not in a git repo, use directory basename
  4. If detection fails entirely, fall back to `"Workspace N"`
  5. Set name_source to `Auto`
- **Postcondition**: Workspace has a meaningful name derived from context
- **Business Rules**:
  - BR-7: Auto-names use git branch when available, directory basename otherwise
  - BR-8: Auto-named Workspaces can be refreshed when the branch changes (name_source == Auto)
  - BR-9: Duplicate auto-names get a numeric suffix (e.g., `main`, `main (2)`)

### UC-4: RenameWorkspace

- **Actor**: User
- **Trigger**: Double-click Workspace name in Workspace rail, or future rename action
- **Precondition**: Target Workspace exists
- **Flow**:
  1. Show inline rename input in the Workspace rail item
  2. User types new name, presses Enter
  3. Update `workspace.name`, set name_source to `Manual`
- **Postcondition**: Workspace name updated, name_source is Manual (no auto-refresh)
- **Business Rules**:
  - BR-10: Manual names are never overwritten by auto-detection
  - BR-11: Empty name input cancels the rename

### UC-5: AssignWorkspaceColor

- **Actor**: System
- **Trigger**: Workspace creation
- **Precondition**: None
- **Flow**:
  1. Assign `color_index = next_color_index % PALETTE_SIZE`
  2. Increment `next_color_index`
  3. Render color dot in Workspace rail, titlebar, and Pane border tint
- **Postcondition**: Workspace has a unique-ish accent color
- **Business Rules**:
  - BR-12: Colors cycle through the palette; duplicates are acceptable when Workspace count exceeds palette size
  - BR-13: Color is assigned at creation and never changes (stable identity)
  - BR-14: Color dot is always visible in the titlebar indicator, regardless of Workspace rail state

### UC-6: OpenWorktreeInNewWorkspace

- **Actor**: User
- **Trigger**: In GitSwitcher Worktrees tab, user activates "New Workspace" action on a worktree entry
- **Precondition**: GitSwitcherState is open in Worktrees mode, selected worktree is not the current one
- **Flow**:
  1. Close GitSwitcher modal
  2. Call `new_workspace()` with the worktree path as CWD and worktree branch as name
  3. The initial terminal in the new Workspace starts in the worktree directory
- **Postcondition**: New Workspace exists with CWD set to the worktree path, named after the branch
- **Business Rules**:
  - BR-15: The new Workspace's initial terminal CWD is the worktree path
  - BR-16: The Workspace auto-names from the worktree branch (name_source = Auto)
  - BR-17: The original Workspace is preserved (not modified)

### UC-7: RenderRicherWorkspaceRail

- **Actor**: System (view layer)
- **Trigger**: Workspace rail is visible and needs rendering
- **Precondition**: `ws.show_sidebar == true`
- **Flow**:
  1. For each Workspace, render: color dot, name, branch (if available), Pane count
  2. For inactive Workspaces, derive branch and CWD from stored terminal Panes
  3. Active Workspace uses live App data (existing behavior, extended)
- **Postcondition**: All Workspace rail items show rich metadata
- **Business Rules**:
  - BR-18: Branch is derived from the first terminal Pane's TerminalContext in each Workspace
  - BR-19: Pane count is `workspace.panes.len()` for cold-stored, `self.panes.len()` for active
  - BR-20: Color dot is rendered left of the name, sized at 6x6px with the Workspace's palette color

## Invariants

1. **ModalStack exclusivity**: WorkspacePickerState is mutually exclusive with all other modals (enforced by ModalStack)
2. **Name uniqueness is NOT enforced**: Multiple Workspaces can have the same name (user may have two `main` Workspaces). Fuzzy picker disambiguates via branch/CWD.
3. **Color stability**: A Workspace's color_index never changes after creation
4. **Auto-name refresh boundary**: Only Workspaces with `name_source == Auto` can have their name refreshed; `Manual` names are immutable by the system
5. **PaneId sync preserved**: All new Use Cases that create Workspaces must maintain the PaneId sync invariant (every PaneId in SplitLayout exists in App.panes, and vice versa)
6. **Single active Workspace**: All Use Cases that switch Workspaces go through `switch_workspace()`, preserving the hot/cold swap invariant

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1: OpenWorkspacePicker | BR-1 | `workspace_picker_fuzzy_matches_name_branch_and_cwd()` |
| UC-1: OpenWorkspacePicker | BR-2 | `workspace_picker_shows_current_workspace_highlighted()` |
| UC-1: OpenWorkspacePicker | BR-3 | `workspace_picker_with_empty_input_shows_all_workspaces()` |
| UC-1: OpenWorkspacePicker | BR-4 | `workspace_picker_esc_closes_without_switching()` |
| UC-2: CreateWorkspaceFromPicker | BR-5 | `workspace_picker_shows_create_row_when_no_match()` |
| UC-2: CreateWorkspaceFromPicker | BR-6 | `workspace_picker_create_uses_typed_name_as_manual()` |
| UC-3: AutoNameWorkspace | BR-7 | `new_workspace_auto_names_from_git_branch()` |
| UC-3: AutoNameWorkspace | BR-8 | `auto_named_workspace_refreshes_on_branch_change()` |
| UC-3: AutoNameWorkspace | BR-9 | `duplicate_auto_names_get_numeric_suffix()` |
| UC-4: RenameWorkspace | BR-10 | `manual_rename_prevents_auto_refresh()` |
| UC-4: RenameWorkspace | BR-11 | `empty_rename_input_cancels_rename()` |
| UC-5: AssignWorkspaceColor | BR-12 | `workspace_color_cycles_through_palette()` |
| UC-5: AssignWorkspaceColor | BR-13 | `workspace_color_is_stable_after_creation()` |
| UC-5: AssignWorkspaceColor | BR-14 | `titlebar_shows_color_dot_without_sidebar()` |
| UC-6: OpenWorktreeInNewWorkspace | BR-15 | `new_workspace_from_worktree_sets_terminal_cwd()` |
| UC-6: OpenWorktreeInNewWorkspace | BR-16 | `new_workspace_from_worktree_auto_names_from_branch()` |
| UC-6: OpenWorktreeInNewWorkspace | BR-17 | `new_workspace_from_worktree_preserves_original()` |
| UC-7: RenderRicherWorkspaceRail | BR-18 | `sidebar_shows_branch_for_inactive_workspaces()` |
| UC-7: RenderRicherWorkspaceRail | BR-19 | `sidebar_shows_pane_count_for_all_workspaces()` |
| UC-7: RenderRicherWorkspaceRail | BR-20 | `sidebar_renders_color_dot_for_each_workspace()` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Domain - Input | `domain/input/mod.rs` | GlobalAction::OpenWorkspacePicker, RenameWorkspace |
| Domain - Modal | `domain/modal/mod.rs` | WorkspacePickerState (new) |
| Domain - State | `domain/state/workspace_mgr.rs` | WorkspaceManager (color counter), Workspace (name_source, color_index) |
| Service | `application/services/workspace_infra_service/mod.rs` | Auto-naming, rename, picker create-on-switch |
| View - Chrome | `adapter/outward/view/chrome/titlebar.rs` | Richer Workspace rail, persistent indicator |
| View - Overlay | `adapter/outward/view/overlays/` | WorkspacePicker rendering (new file) |
| Inward Adapter | `adapter/inward/keyboard_adapter/modal.rs` | Picker keyboard handling |
| Theme | `theme.rs` | WORKSPACE_PALETTE constant |
| Tests | `application/behavior_tests/` | workspace_picker_behavior (new), workspace_naming_behavior (new) |
