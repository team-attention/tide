# Spec: File Tree Bundle Handoff

## Overview

### As-Is

`FsTree::read_directory()` in [crates/tide-app/src/domain/tree/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/domain/tree/mod.rs:12) follows filesystem metadata and marks macOS `.app` bundles as directories because they are directories on disk. `handle_file_tree_click()` in [crates/tide-app/src/application/services/file_tree_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/file_tree_service/mod.rs:689) therefore toggles a `.app` row instead of opening an `Editor Pane`, so plain `FileTree` activation is not the external-launch path.

The only `FileTree` path that hands a directory to the OS is `ContextMenuAction::RevealInFinder` in [crates/tide-app/src/application/services/file_tree_service/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/application/services/file_tree_service/mod.rs:602). That branch currently sends every directory through `ProcessPort::open_with_default_app()`. `SystemProcess::open_with_default_app()` in [crates/tide-app/src/adapter/outward/process_adapter/mod.rs](/Users/eatnug/Workspace/tide/crates/tide-app/src/adapter/outward/process_adapter/mod.rs:29) shells out to `open <path>`, which launches a bundled macOS app when the directory path ends in `.app`.

For `Tide.app`, that means a `FileTree` "Open in Finder" action can relaunch Tide itself. In a Full-Screen Space this produces an extra Tide launch instead of revealing the bundle in Finder, matching the user's screenshot and report.

### To-Be

`FileTree` must split app-bundle behavior by user intent instead of treating every `.app` directory like an ordinary folder.

On plain activation, a `.app` row launches through the default macOS app handoff instead of expanding as a directory. On `Open in Finder`, the same `.app` row opens through Finder explicitly, so the user sees the bundle without relaunching it. Normal directories still use the current open-directory handoff, and ordinary files still use Finder reveal.

### Approach

1. Add a small helper in `file_tree_service` that recognizes `.app` bundle directories by directory status plus case-insensitive `.app` extension.
2. Update `execute_context_menu_action()` so `ContextMenuAction::RevealInFinder` routes app-bundle directories to `ProcessPort::reveal_in_finder()` instead of `open_with_default_app()`.
3. Preserve the existing behavior for ordinary directories and files.
4. Add behavior tests that pin plain app-bundle activation, the Finder adapter path for app bundles, and the normal-directory fallback.

## Bounded Contexts

| Module | Path | Role |
|--------|------|------|
| tree | `crates/tide-app/src/domain/tree/mod.rs` | Produces `FileTree` entries and marks `.app` bundles as directories |
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
- **Postcondition**: The bundled app launches and the `.app` row does not behave like a regular expandable directory.
- **Business Rules**:
  - BR-1: Plain `FileTree` activation on a `.app` directory must launch the bundle instead of toggling directory expansion.

### UC-2: RevealAppBundleInFinder

- **Actor**: User
- **Trigger**: User runs `Open in Finder` on a `.app` directory from the `FileTree` context menu
- **Precondition**: The selected `FileTree` entry is a directory whose path ends with `.app`
- **Flow**:
  1. Tide resolves `ContextMenuAction::RevealInFinder`.
  2. Tide detects that the selected directory is an app bundle.
  3. Tide asks `ProcessPort::reveal_in_finder()` to show the bundle through Finder instead of opening it as a default app.
- **Postcondition**: Finder opens to the bundle's containing folder and Tide does not relaunch the bundled app.
- **Business Rules**:
  - BR-2: `Open in Finder` on a `.app` directory must call Finder reveal instead of default-app launch.
  - BR-3: The macOS process adapter must route `.app` bundle reveal requests through Finder explicitly instead of shelling out to `open <bundle>.app`.

### UC-3: PreserveNormalFinderHandoff

- **Actor**: User
- **Trigger**: User runs `Open in Finder` on a non-bundle directory from the `FileTree` context menu
- **Precondition**: The selected `FileTree` entry is a directory whose path does not end with `.app`
- **Flow**:
  1. Tide resolves `ContextMenuAction::RevealInFinder`.
  2. Tide detects that the selected directory is not an app bundle.
  3. Tide preserves the current directory handoff and calls `ProcessPort::open_with_default_app()`.
- **Postcondition**: Ordinary directories still open in Finder as before.
- **Business Rules**:
  - BR-4: Non-bundle directories must preserve the existing default-app handoff.

## Invariants

1. `FsTree` may still expose `.app` bundles as directories because they are directories on disk.
2. Plain activation and `Open in Finder` may diverge for `.app` bundles without affecting ordinary directories.
3. Files still use `ProcessPort::reveal_in_finder()` for Finder reveal.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1 | `clicking_app_bundle_in_file_tree_launches_it_instead_of_toggling_directory_expansion` |
| UC-2 | BR-2 | `open_in_finder_reveals_app_bundles_without_launching_them` |
| UC-2 | BR-3 | `system_process_routes_app_bundle_open_in_finder_through_finder_app` |
| UC-3 | BR-4 | `open_in_finder_keeps_default_directory_handoff_for_non_bundle_directories` |

## Location

| Layer | Path | Key Files |
|-------|------|-----------|
| Spec | `docs/specs/` | `file-tree-bundle-handoff.md` |
| Services | `crates/tide-app/src/application/services/` | `file_tree_service/mod.rs` |
| Process Adapter | `crates/tide-app/src/adapter/outward/` | `process_adapter/mod.rs` |
| Behavior Tests | `crates/tide-app/src/application/behavior_tests/` | `file_tree_bundle_behavior.rs` |
