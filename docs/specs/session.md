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

Session restore continues to preserve saved layout and preferences. Ordinary
launch creates the native `Tide Window` from default `WindowConfig` size instead
of restoring `Session.window_width` / `Session.window_height`. A fresh launch
without a saved `Session` keeps the initial `Terminal` at the startup geometry
until layout computation resizes the `Terminal Pane` to the Stage content rect.

The default non-crash launch surface is intentionally sparse: Workspace rail
plus the first `Terminal Pane` only. FileTree View and Terminal Context Surface
start closed even if a previous intentional quit saved them as open; width,
theme, and window preferences still restore.

If the saved preference is light mode, the first `Terminal Pane` must use the
light terminal palette from the first frame, including when Tide installs a
pre-spawned `Terminal`.

### Approach

1. Preserve the existing `Session` serialization contract.
2. Build ordinary launch `WindowConfig` from platform defaults, not saved
   native `Tide Window` dimensions.
3. Treat the first no-session `Terminal Pane` as an 80x24 startup pane.
4. Let layout computation remain responsible for resizing the `Terminal Pane`
   from its startup geometry to the Stage content rect.
5. Reset side-surface visibility during fresh/preference launches while keeping
   full `restore_from_session` behavior for crash recovery.
6. When restoring preferences, apply the restored theme to any pre-spawned
   `Terminal` before installing it as the first `Terminal Pane`.

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

### UC-3: CreateDefaultLaunchSurface

- **Actor**: System
- **Trigger**: App launch that creates a fresh first `Terminal Pane`
- **Precondition**: Tide is not restoring the full crash-recovery `Session`
- **Flow**:
  1. Tide creates the first `Terminal Pane`
  2. Tide shows the Workspace rail
  3. Tide keeps FileTree View closed
  4. Tide keeps Terminal Context Surface closed
  5. Tide applies restored theme preference to the first `Terminal Pane`
- **Postcondition**: The first visible UI contains Workspace rail and Stage
  terminal only
- **Business Rules**:
  - BR-6: A fresh initial Workspace must show Workspace rail and exactly one Stage `Terminal Pane`
  - BR-7: A fresh initial Workspace must keep FileTree View and Terminal Context Surface closed
  - BR-8: `restore_preferences` restores theme and side-surface widths, but must not reopen FileTree View, Workspace rail hidden state, or Terminal Context Surface visibility from a previous intentional quit
  - BR-9: `restore_preferences` must sync the restored `dark_mode` preference into a pre-spawned `Terminal` before the first `Terminal Pane` renders
  - BR-10: Ordinary launch must use default `WindowConfig` size instead of `Session.window_width` / `Session.window_height`

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `session_preserves_dark_mode_preference` |
| UC-1 | BR-2 | `session_preserves_file_tree_visibility` |
| UC-1 | BR-3 | `session_without_sidebar_fields_uses_defaults` |
| UC-2 | BR-4 | `fresh_workspace_keeps_prespawned_terminal_at_startup_geometry_before_layout` |
| UC-2 | BR-5 | `fresh_workspace_uses_startup_geometry_when_creating_initial_terminal_before_layout` |
| UC-3 | BR-6/BR-7 | `fresh_workspace_default_surface_shows_workspace_rail_and_terminal_only` |
| UC-3 | BR-8 | `restore_preferences_starts_from_workspace_rail_and_terminal_only` |
| UC-3 | BR-9 | `restore_preferences_applies_light_mode_to_prespawned_terminal` |
| UC-3 | BR-10 | `launch_window_config_uses_default_size_despite_saved_session_dimensions` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Session | tide-app | `session.rs` |
| Tests | tide-app | `behavior_tests.rs :: mod session_behavior` |
