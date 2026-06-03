# Spec: Dock Placeholder Launcher

## Overview

### As-Is

When Dock is open and user switches to a Terminal that has no dock panes, the Dock shows an empty area with just a "Cmd+Backslash" hint. This is confusing — the Dock is visually open but has no content and no affordance.

When a new pane (editor, browser) is added to the Dock, it can be inserted as a context split via `add_pane_to_dock()`, even if the only thing in the Dock is a placeholder Launcher.

### To-Be

**Placeholder Launcher**: When Dock is open and the focused Terminal's dock_layout is empty, a Launcher pane is automatically created as a placeholder. This Launcher is visually identical to a normal Launcher but acts as a slot to be replaced.

**Replace on open**: When a pane is opened into the Dock (file open, browser open, new editor) and the current dock_focused is a Launcher, the Launcher is removed and the new pane takes its slot instead of being added as a sibling split.

### Approach

1. Add `ensure_dock_placeholder()` — if dock is open and focused Terminal's dock_layout is empty, create a Launcher.
2. Call `ensure_dock_placeholder()` in `swap_dock_state()` (terminal focus change) and `handle_focus_area(Stage→Dock)`.
3. Add `dock_launcher_id()` — returns dock_focused if it's a Launcher, None otherwise.
4. In pane-opening functions (`open_editor_pane`, `open_browser_pane`, `new_editor_pane`), before `add_pane_to_dock()`, check `dock_launcher_id()`. If Some, replace that Launcher with the new pane instead of adding.

## Bounded Contexts

- `tide-app` — Dock placeholder logic, pane lifecycle

## Use Cases

### UC-1: PlaceholderOnTerminalSwitch

- **Actor**: User
- **Trigger**: HJKL navigation or click that switches focused Terminal in Stage while Dock is open
- **Precondition**: Dock is open, incoming Terminal's dock_layout is empty
- **Flow**:
  1. `focus_terminal(id)` calls `swap_dock_state(id)`
  2. `swap_dock_state` detects dock_layout is empty for this Terminal
  3. Create Launcher pane, add to this Terminal's dock_layout via `add_pane_to_dock`
  4. Set dock_focused to the new Launcher
- **Postcondition**: Dock shows Launcher for the focused Terminal
- **Business Rules**:
  - BR-1: Only create Launcher if dock_layout is empty (not if it already has panes)
  - BR-2: If dock_layout already has a Launcher (e.g., from a previous visit), do not create another
  - BR-3: Placeholder Launcher is a normal Launcher pane — no special PaneKind

### UC-2: ReplacePlaceholderOnOpen

- **Actor**: User
- **Trigger**: Open file from FileTree, FileFinder, Ctrl+Click URL, or GlobalAction::NewFile
- **Precondition**: Dock has a placeholder Launcher as dock_focused
- **Flow**:
  1. Detect dock_focused is a Launcher via `dock_launcher_id()`
  2. Create new pane (editor, browser, etc.)
  3. Replace the Launcher's slot in dock_layout with the new pane (same context slot)
  4. Remove Launcher from App.panes, cleanup
  5. Set dock_focused to new pane
- **Postcondition**: New pane occupies the Launcher's slot, Launcher is gone
- **Business Rules**:
  - BR-1: Only replace if dock_focused is a Launcher — if dock_focused is any other PaneKind, add as a normal context split
  - BR-2: The replacement uses the same TabGroup slot (not a new split)
  - BR-3: If the Launcher is the only pane in dock_layout, after replacement the new pane is still the only pane

### UC-3: PlaceholderNotDuplicated

- **Actor**: User
- **Trigger**: Repeatedly switching between Terminals (HJKL back and forth)
- **Precondition**: Dock is open, Terminal A has a placeholder Launcher, user navigates away and back
- **Flow**:
  1. Navigate to Terminal B (Dock shows B's content or B's placeholder)
  2. Navigate back to Terminal A
  3. `swap_dock_state` checks — A's dock_layout is NOT empty (has the Launcher from before)
  4. No new Launcher created
- **Postcondition**: Terminal A still has exactly one Launcher in dock_layout
- **Business Rules**:
  - BR-1: `ensure_dock_placeholder()` only creates when dock_layout is empty, never when it has any pane

## Invariants

1. **Dock never empty while open**: If dock_open is true, the focused Terminal's dock_layout always has at least one pane
2. **At most one placeholder**: A Terminal's dock_layout never has more than one auto-created Launcher
3. **PaneId sync**: Placeholder Launchers are normal panes in App.panes — no special tracking needed

## Tests

| UC | BR | Test Function |
|----|-----|---------------|
| UC-1 | BR-1 | `dock_placeholder_created_on_terminal_switch_when_dock_empty()` |
| UC-1 | BR-2 | `dock_placeholder_not_created_when_dock_has_panes()` |
| UC-2 | BR-1 | `open_file_replaces_dock_placeholder_launcher()` |
| UC-2 | BR-1 | `open_browser_replaces_dock_placeholder_launcher()` |
| UC-2 | BR-1 | `open_file_adds_split_when_dock_focused_is_not_launcher()` |
| UC-2 | BR-2 | `replacement_keeps_same_tab_group_slot()` |
| UC-3 | BR-1 | `switching_back_does_not_duplicate_placeholder()` |

## Location

- `crates/tide-app/src/action/dock.rs` — `ensure_dock_placeholder()`, `dock_launcher_id()`
- `crates/tide-app/src/action/pane_lifecycle.rs` — replace logic in `open_editor_pane`, `open_browser_pane`, `new_editor_pane`
- `crates/tide-app/src/behavior_tests.rs` — new test section
