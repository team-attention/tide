# Spec: Session

## Overview

### As-Is

Session save/load persists and restores App state across launches. On a launch
without a saved `Session`, `init_phase1` pre-spawns a `Terminal` at 80x24 before
GPU initialization, then `create_initial_pane` installs that `Terminal` as the
first `Terminal Pane`. `create_initial_pane` also derives terminal rows and
columns from the whole Tide Window before the Stage layout has assigned a
content rect.

### To-Be

Session restore continues to preserve saved layout and preferences. A fresh
launch without a saved `Session` keeps the initial `Terminal` at the startup
geometry until layout computation resizes the `Terminal Pane` to the Stage
content rect.

### Approach

1. Preserve the existing `Session` serialization contract.
2. Treat the first no-session `Terminal Pane` as an 80x24 startup pane.
3. Let layout computation remain responsible for resizing the `Terminal Pane`
   from its startup geometry to the Stage content rect.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Session serialization/deserialization |
| `layout` | Stage content sizing for `Terminal Pane` resize |
| `terminal` | Initial `Terminal` geometry and later PTY resize |

## Use Cases

### UC-1: SaveLoadSession

- **Actor**: System
- **Trigger**: App quit (save) or App launch (load)
- **Precondition**: None
- **Flow**:
  1. Save: serialize layout, focus, preferences to JSON
  2. Load: deserialize JSON, restore layout and preferences
- **Postcondition**: App state preserved across sessions
- **Business Rules**:
  - BR-1: Session preserves dark_mode preference
  - BR-2: Session preserves file tree visibility and width
  - BR-3: Session without sidebar fields uses defaults (left side, outer position)

### UC-2: CreateFreshWorkspaceWithoutSession

- **Actor**: System
- **Trigger**: App launch
- **Precondition**: No saved `Session` is available
- **Flow**:
  1. `init_phase1` creates or receives an initial 80x24 `Terminal`
  2. `create_initial_pane` installs that `Terminal` as the first `Terminal Pane`
  3. Layout computation later resizes the `Terminal Pane` to the Stage content rect
- **Postcondition**: The first `Terminal Pane` starts with the same geometry as
  ordinary newly-created terminals until layout assigns its Stage rect
- **Business Rules**:
  - BR-4: A pre-spawned initial `Terminal` must not be resized from 80x24 using the whole Tide Window before layout computation
  - BR-5: A non-pre-spawned initial `Terminal` must use the same 80x24 startup geometry before layout computation

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `session_preserves_dark_mode_preference` |
| UC-1 | BR-2 | `session_preserves_file_tree_visibility` |
| UC-1 | BR-3 | `session_without_sidebar_fields_uses_defaults` |
| UC-2 | BR-4 | `fresh_workspace_keeps_prespawned_terminal_at_startup_geometry_before_layout` |
| UC-2 | BR-5 | `fresh_workspace_uses_startup_geometry_when_creating_initial_terminal_before_layout` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Session | tide-app | `session.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod session_behavior` |
