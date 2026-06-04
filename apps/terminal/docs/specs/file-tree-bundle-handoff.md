# Spec: File Tree Bundle Handoff

## Overview

### As-Is

`FsTree::read_directory()` in [crates/tide-app/src/domain/tree/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/domain/tree/mod.rs:12) follows filesystem metadata and marks macOS `.app` bundles as directories because they are directories on disk. `handle_file_tree_click()` in [crates/tide-app/src/application/services/file_tree_service/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/application/services/file_tree_service/mod.rs:689) therefore toggles a `.app` row instead of opening an `Editor Pane`, so plain `FileTree` activation is not the external-launch path.

`ContextMenuAction::items()` in [crates/tide-app/src/domain/modal/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/domain/modal/mod.rs:843) still treats every directory alike. A `.app` bundle gets the same `Open in Finder` label as an ordinary directory even though plain activation already launches the app. In [crates/tide-app/src/application/services/file_tree_service/mod.rs](/Users/you/Workspace/tide/crates/tide-app/src/application/services/file_tree_service/mod.rs:602), that action routes app bundles to `ProcessPort::reveal_in_finder()`, so the context menu still exposes Finder reveal as the only explicit action on the bundle.

For `Tide.app`, that means the `FileTree` context menu does not offer an app-specific launch action even though the row itself already launches on plain activation. The label/action mismatch makes the bundle feel like a directory operation instead of an app operation.

### To-Be

`FileTree` must split app-bundle behavior by user intent instead of treating every `.app` directory like an ordinary folder.

On plain activation, a `.app` row launches through the default macOS app handoff instead of expanding as a directory. In the context menu, a `.app` row exposes an explicit `Open App` action for the same launch path and keeps a separate Finder-reveal action with a Finder-specific label. Normal directories still use the current open-directory handoff, and ordinary files still use Finder reveal.

### Approach

1. Add a small helper in `file_tree_service` that recognizes `.app` bundle directories by directory status plus case-insensitive `.app` extension.
2. Make `ContextMenuAction` and `ContextMenuState` app-bundle-aware so `.app` rows get a dedicated app-launch action set instead of the generic directory action set.
3. Update `execute_context_menu_action()` so the app-launch action routes `.app` bundles to `ProcessPort::open_with_default_app()`, while the Finder-reveal action continues to route through `ProcessPort::reveal_in_finder()`.
4. Preserve the existing behavior for ordinary directories and files.
5. Route `.app` Finder reveal through the standard macOS reveal handoff now that app launch has its own explicit context-menu action.
6. Add behavior tests that pin plain app-bundle activation, app-bundle context-menu launch, Finder reveal, and the normal-directory fallback.

## Bounded Contexts

| Module | Path | Role |
|--------|------|------|
| tree | `crates/tide-app/src/domain/tree/mod.rs` | Produces `FileTree` entries and marks `.app` bundles as directories |
| modal | `crates/tide-app/src/domain/modal/mod.rs` | Defines app-bundle-specific `FileTree` context menu actions and labels |
| file tree service | `crates/tide-app/src/application/services/file_tree_service/mod.rs` | Executes `FileTree` context menu actions |
| process adapter | `crates/tide-app/src/adapter/outward/process_adapter/mod.rs` | Maps process handoff requests to macOS `open` commands |

## Use Cases

### UC-1: ActivateAppBundleFromFileTree

- **Actor**: User
- **Trigger**: User plain-clicks a `.app` directory row in the `FileTree`
- **Precondition**: The selected `FileTree` entry is a directory whose path ends with `.app`
- **Flow**:
  1. Tide resolves the clicked `FileTree` entry.
  2. Tide detects that the selected directory is an app bundle.
  3. Tide launches the bundle through `ProcessPort::open_with_default_app()` instead of toggling tree expansion.
- **Postcondition**: The bundled app launches, the current `Tide Window` stays open, and the `.app` row does not behave like a regular expandable directory.
- **Business Rules**:
  - BR-1: Plain `FileTree` activation on a `.app` directory must launch the bundle instead of toggling directory expansion.
  - BR-2: Successful plain `FileTree` activation on a `.app` directory must not queue `WindowCommand::CloseWindow` for the current `Tide Window`.

### UC-2: OpenAppBundleFromContextMenu

- **Actor**: User
- **Trigger**: User runs `Open App` on a `.app` directory from the `FileTree` context menu
- **Precondition**: The selected `FileTree` entry is a directory whose path ends with `.app`
- **Flow**:
  1. Tide resolves the app-bundle-specific context menu.
  2. Tide detects that the selected directory is an app bundle.
  3. Tide launches the bundle through `ProcessPort::open_with_default_app()`.
- **Postcondition**: The context menu provides an explicit app-launch action that matches plain row activation, and successful launch leaves the current `Tide Window` open.
- **Business Rules**:
  - BR-3: `.app` directories must expose an explicit `Open App` context-menu action instead of reusing the generic directory action set.
  - BR-4: `Open App` on a `.app` directory must call `ProcessPort::open_with_default_app()`.
  - BR-5: Successful `Open App` on a `.app` directory must not queue `WindowCommand::CloseWindow` for the current `Tide Window`.

### UC-3: RevealAppBundleInFinder

- **Actor**: User
- **Trigger**: User runs Finder reveal on a `.app` directory from the `FileTree` context menu
- **Precondition**: The selected `FileTree` entry is a directory whose path ends with `.app`
- **Flow**:
  1. Tide resolves the Finder-reveal action from the app-bundle-specific context menu.
  2. Tide detects that the selected directory is an app bundle.
  3. Tide asks `ProcessPort::reveal_in_finder()` to show the bundle through Finder instead of opening it as a default app.
- **Postcondition**: Finder reveals the bundle in place without relaunching the bundled app or opening extra Finder windows.
- **Business Rules**:
  - BR-6: `.app` directories must keep a separate Finder-reveal action that is labeled as Finder-specific instead of app-launch-specific.
  - BR-7: Finder reveal on a `.app` directory must call Finder reveal instead of default-app launch.
  - BR-8: The macOS process adapter must route `.app` bundle reveal requests through the standard Finder reveal handoff instead of a Finder-specific parent-directory open path.

### UC-4: PreserveNormalFinderHandoff

- **Actor**: User
- **Trigger**: User runs `Open in Finder` on a non-bundle directory from the `FileTree` context menu
- **Precondition**: The selected `FileTree` entry is a directory whose path does not end with `.app`
- **Flow**:
  1. Tide resolves `ContextMenuAction::RevealInFinder`.
  2. Tide detects that the selected directory is not an app bundle.
  3. Tide preserves the current directory handoff and calls `ProcessPort::open_with_default_app()`.
- **Postcondition**: Ordinary directories still open in Finder as before.
- **Business Rules**:
  - BR-9: Non-bundle directories must preserve the existing default-app handoff.

## Invariants

1. `FsTree` may still expose `.app` bundles as directories because they are directories on disk.
2. Plain activation and context-menu activation may both launch `.app` bundles without affecting ordinary directories.
3. Files still use `ProcessPort::reveal_in_finder()` for Finder reveal.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1 | `clicking_app_bundle_in_file_tree_launches_it_instead_of_toggling_directory_expansion` |
| UC-1 | BR-2 | `clicking_app_bundle_in_file_tree_leaves_the_current_tide_window_open_after_launch` |
| UC-2 | BR-3 | `app_bundle_context_menu_uses_app_specific_actions_instead_of_directory_actions` |
| UC-2 | BR-4 | `open_app_launches_app_bundles_from_the_file_tree_context_menu` |
| UC-2 | BR-5 | `open_app_leaves_the_current_tide_window_open_after_launch` |
| UC-3 | BR-6 | `app_bundle_context_menu_keeps_a_finder_specific_reveal_label` |
| UC-3 | BR-7 | `finder_reveal_reveals_app_bundles_without_launching_them` |
| UC-3 | BR-8 | `system_process_routes_app_bundle_reveal_through_standard_finder_reveal` |
| UC-4 | BR-9 | `open_in_finder_keeps_default_directory_handoff_for_non_bundle_directories` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Spec | `docs/specs/` | `file-tree-bundle-handoff.md` |
| Services | `crates/tide-app/src/application/services/` | `file_tree_service/mod.rs` |
| Process Adapter | `crates/tide-app/src/adapter/outward/` | `process_adapter/mod.rs` |
| Behavior Tests | `crates/tide-app/src/application/behavior_tests/` | `file_tree_bundle_behavior.rs` |
