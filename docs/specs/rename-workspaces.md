# Spec: Rename Workspaces

User-driven renaming of Workspaces via right-click on the Workspace rail, an inline rename modal, and an MCP tool for Wrapped Agents.

Tracks upstream issue: [team-attention/tide#98](https://github.com/team-attention/tide/issues/98).

## Overview

### As-Is

- `Workspace.name: String` exists (`crates/tide-app/src/application/services/workspace_infra_service/mod.rs:17`).
- The only assignment site hard-codes `format!("Workspace {}", self.ws.workspaces.len() + 1)` (`workspace_infra_service/mod.rs:418`, `:440`).
- The Workspace rail reads and renders `app.ws.workspaces[i].name` directly (`adapter/outward/view/chrome/titlebar.rs:625`), with a fallback to `format!("Workspace {}", app.ws.active + 1)` in the titlebar (`titlebar.rs:76-81`).
- No port method, GlobalAction, modal, context-menu entry, or MCP tool mutates the name after creation. Right-click on a Workspace rail item is unhandled — `mouse_adapter/mod.rs:221` only branches on the FileTree View rect.
- `ContextMenuState` (`domain/modal/mod.rs:963`) is file-tree-coupled: it embeds `entry_index`, `path`, `is_dir`, `is_app_bundle`, `shell_idle`. `execute_context_menu_action` lives in `file_tree_service` and dispatches on that file-tree shape (`application/services/file_tree_service/mod.rs:573`).
- A clean inline-rename pattern already exists for files: `FileTreeRenameState { entry_index, original_path, input: InputLine }` (`domain/modal/mod.rs:1131`), with a dedicated keyboard handler (`adapter/inward/keyboard_adapter/modal.rs:386`), text routing (`adapter/inward/text_routing_adapter/mod.rs:59`), and rendering (`adapter/outward/view/chrome/file_tree.rs:272`).
- `WorkspaceManager.workspaces` is empty until `new_workspace()` runs (`workspace_infra_service/mod.rs:414-429`). The active Workspace's live state lives in `App` fields (`panes`, `layout`, `focus`) and only lands in the Vec when the user creates a second Workspace. As a consequence the Workspace rail draws zero items for the entire lifetime of a single-Workspace session, so right-click on the rail has no hit-target and a future MCP `rename-workspace` call on `ws_index = 0` would fail out-of-bounds.

### To-Be

- A Workspace can be renamed by the User from the Workspace rail and by a Wrapped Agent through the Tide MCP Runtime.
- Right-click on a Workspace rail item opens a ContextMenu with a single `Rename` entry. Selecting it opens a `WorkspaceRenameState` modal with an `InputLine` seeded with the current name, drawn over the rail item rect. Enter commits, Escape cancels.
- A new MCP tool `tide_rename_workspace { ws_index?: number, name: string }` performs the same mutation. When `ws_index` is omitted, the active Workspace is renamed.
- An empty / whitespace-only name is rejected (silent no-op). Names of any non-empty UTF-8 string are accepted; the rail's existing truncation handles long labels.
- The new name persists across Workspace switches (no extra save/load plumbing needed: `Workspace.name` is part of the cold-stored Workspace struct, not swapped into App fields).

### Approach

1. Add to `WorkspaceNavPort`: `rename_workspace(idx, name)` (mutator), `complete_workspace_rename()` (modal-commit entry called from the keyboard handler), and `workspace_name(idx) -> Option<String>` (read accessor used by the MCP echo so the cli adapter does not bypass the port). Implement all three on `App` in `workspace_service`.
2. Extract the lazy-seed buried inside `new_workspace` into a reusable `App::ensure_initial_workspace_seeded()`. Call it from `main.rs` right after `App::new()` so the active Workspace is in the Vec from boot — fixing the rail-draws-zero-items case described in As-Is. Also call it from `rename_workspace` and `execute_workspace_context_menu_action` when `idx == ws.active`, as a safety net for code paths that build an `App` outside `main.rs`.
3. Generalize `ContextMenuState` to a tagged target (`ContextMenuTarget::FileTreeEntry { … } | WorkspaceSidebarItem { ws_index }`); move `ContextMenuAction::items()` to take the target; split `execute_context_menu_action` so workspace actions dispatch to `workspace_service` and file-tree actions stay in `file_tree_service`.
4. Add right-click handling for the Workspace rail item in `mouse_adapter`.
5. Add `WorkspaceRenameState { ws_index, input: InputLine }` to `ModalStack`. Mirror `FileTreeRenameState` for keyboard handling, text routing, and `is_any_open()` / `close_all()` participation.
6. Render the InputLine over the rail item rect when `workspace_rename` is active for that index, replacing the static `display_name` draw in `titlebar.rs`.
7. Register `tide_rename_workspace` in the Tide MCP Runtime — entry in `mcp.rs` tool list, mapping in the tool-name switch, `"rename-workspace" => cli_rename_workspace(self, params)` in `commands.rs:dispatch`. `cli_rename_workspace` calls the port method and echoes `{ ws_index, name }`.
8. Add behavior tests in `application/behavior_tests/workspace_behavior.rs`, `text_input_routing.rs`, and `cli_workspace_routing.rs`.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Owns the Workspace list, ModalStack, ContextMenuState, and the MCP runtime dispatch |
| `domain/modal` | Adds `WorkspaceRenameState`; refactors `ContextMenuState` to a tagged target |
| `application/ports/inward/workspace_nav_port` | New `rename_workspace` method |
| `application/services/workspace_service` | Implements rename; handles workspace ContextMenu actions |
| `application/services/file_tree_service` | Loses the workspace branch of `execute_context_menu_action`; still owns the FileTree branch |
| `adapter/inward/mouse_adapter` | Right-click on Workspace rail item opens the new ContextMenu |
| `adapter/inward/keyboard_adapter` | Routes Enter / Escape / editing keys for `workspace_rename` |
| `adapter/inward/text_routing_adapter` | Routes characters to `workspace_rename.input` |
| `adapter/outward/view/chrome/titlebar.rs` | Renders the InputLine over the rail item rect when rename is active |
| `adapter/inward/cli_adapter` | Registers the `tide_rename_workspace` MCP tool and dispatches the `rename-workspace` method |

## Use Cases

### UC-1: RenameWorkspace

- **Actor**: User (via Workspace rail context menu) or Wrapped Agent (via `tide_rename_workspace`)
- **Trigger**: Right-click → Rename in the Workspace rail item ContextMenu, or `tide_rename_workspace` MCP call
- **Precondition**: Target Workspace exists (`ws_index < ws.workspaces.len()`)
- **Flow**:
  1. Trim leading/trailing whitespace from the new name.
  2. If empty after trimming, no-op.
  3. Write `name` into `ws.workspaces[idx].name` (works for active or cold-stored Workspace; no save/load needed because `name` is not one of the fields swapped into App fields).
  4. Invalidate the chrome cache so the Workspace rail re-renders.
- **Postcondition**: `ws.workspaces[idx].name` equals the trimmed input; rail re-renders the new label.
- **Business Rules**:
  - BR-1: `rename_workspace` updates the name of the active Workspace.
  - BR-2: `rename_workspace` updates the name of a cold-stored (inactive) Workspace.
  - BR-3: Empty or whitespace-only names are rejected (no mutation).
  - BR-4: The renamed name survives a switch out and back to the Workspace.
  - BR-5: Out-of-bounds `ws_index` is a no-op.
  - BR-6: When the target is the active Workspace and `ws.workspaces` is empty (fresh `App`, no `new_workspace` call yet), `rename_workspace` calls `ensure_initial_workspace_seeded` to push the live state into the Vec before writing the new name. This makes idx 0 reachable for both the rail context menu and the MCP path on the very first user action.

### UC-2: OpenWorkspaceRenameModal

- **Actor**: User
- **Trigger**: Right-click on a Workspace rail item → select `Rename`
- **Precondition**: Workspace rail is visible; hit-target is a Workspace rail item
- **Flow**:
  1. Right-click on a Workspace rail item opens a ContextMenu with target `ContextMenuTarget::WorkspaceSidebarItem { ws_index }` and a single action `Rename`.
  2. Selecting `Rename` (Enter on the highlighted item, or clicking it) takes the menu, opens `ModalStack.workspace_rename = Some(WorkspaceRenameState { ws_index, input: InputLine::with_text(current_name) })`.
  3. The Workspace rail renders the InputLine in place of the static name at `item_rect` for `ws_index`.
  4. Keyboard input is routed to the InputLine; the InputLine cursor is visible.
  5. Enter commits via `rename_workspace`; Escape cancels by setting `workspace_rename = None`.
- **Postcondition**: After Enter the Workspace name is updated and the modal is closed; after Escape the name is unchanged and the modal is closed.
- **Business Rules**:
  - BR-1: Right-click on a Workspace rail item opens a ContextMenu with a `Rename` entry.
  - BR-2: Selecting `Rename` opens `workspace_rename` seeded with the current name.
  - BR-3: Enter commits and closes the modal; the new name appears on the rail.
  - BR-4: Escape cancels and closes the modal; the name is unchanged.
  - BR-5: An empty / whitespace-only commit leaves the name unchanged.
  - BR-6: While `workspace_rename` is open, character keys go to the InputLine (text routing).
  - BR-7: `workspace_rename` participates in `ModalStack::is_any_open()` and `close_all()`.

### UC-3: RenameWorkspaceViaMcp

- **Actor**: Wrapped Agent
- **Trigger**: `tide_rename_workspace { ws_index?: number, name: string }` MCP tool call
- **Precondition**: Wrapped Agent is authorized through the Agent Gateway
- **Flow**:
  1. Resolve `ws_index`: use the provided value, else default to the currently active Workspace.
  2. Invoke `rename_workspace(ws_index, name)`.
  3. Return `{ "ws_index": idx, "name": new_name }`.
- **Postcondition**: Same as UC-1; the tool result echoes the resolved index and new name.
- **Business Rules**:
  - BR-1: `tide_rename_workspace` with `ws_index` renames the targeted Workspace.
  - BR-2: `tide_rename_workspace` without `ws_index` renames the active Workspace.
  - BR-3: `tide_rename_workspace` with empty `name` is a no-op and returns the unchanged name.
  - BR-4: `tide_rename_workspace` with out-of-bounds `ws_index` returns an error and does not mutate state.

## Invariants

1. **Modal exclusivity preserved**: Opening `workspace_rename` clears `context_menu` (the menu transitions into the modal); `ModalStack::is_any_open()` and `close_all()` include `workspace_rename`.
2. **PaneId sync unaffected**: Rename mutates only `Workspace.name`; it does not touch SplitLayout, panes, or focus.
3. **Hexagonal direction preserved**: Inward adapters (`mouse_adapter`, `keyboard_adapter`, `cli_adapter`) call `WorkspaceNavPort::rename_workspace`; they never mutate `ws.workspaces[idx].name` directly.
4. **ContextMenu target tagging**: `ContextMenuState.target` is the single source of truth for which menu items are shown and which service handles execution.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1 | `rename_workspace_updates_active_workspace_name` |
| UC-1 | BR-2 | `rename_workspace_updates_cold_stored_workspace_name` |
| UC-1 | BR-3 | `rename_workspace_with_empty_name_is_a_no_op` |
| UC-1 | BR-4 | `rename_workspace_persists_across_switch_out_and_back` |
| UC-1 | BR-5 | `rename_workspace_with_out_of_bounds_index_is_a_no_op` |
| UC-2 | BR-1 | `right_click_on_workspace_sidebar_item_opens_context_menu_with_rename` |
| UC-2 | BR-2 | `selecting_rename_in_workspace_context_menu_opens_workspace_rename_modal` |
| UC-2 | BR-3 | `enter_in_workspace_rename_commits_new_name` |
| UC-2 | BR-4 | `escape_in_workspace_rename_cancels` |
| UC-2 | BR-5 | `empty_commit_in_workspace_rename_leaves_name_unchanged` |
| UC-2 | BR-6 | `text_goes_to_workspace_rename_input_when_active` |
| UC-2 | BR-7 | `workspace_rename_participates_in_modal_is_any_open_and_close_all` |
| UC-3 | BR-1 | `cli_rename_workspace_with_index_renames_targeted_workspace` |
| UC-3 | BR-2 | `cli_rename_workspace_without_index_renames_active_workspace` |
| UC-3 | BR-3 | `cli_rename_workspace_with_empty_name_is_a_no_op` |
| UC-3 | BR-4 | `cli_rename_workspace_with_out_of_bounds_index_returns_error` |
| UC-1 | BR-6 | `rename_workspace_seeds_initial_when_workspaces_vec_is_empty` |

## Location

| Layer | Crate | Key Files |
|-------|-------|-----------|
| Modal state | tide-app | `crates/tide-app/src/domain/modal/mod.rs` (`WorkspaceRenameState`, `ContextMenuTarget`, refactored `ContextMenuState`) |
| Port | tide-app | `crates/tide-app/src/application/ports/inward/workspace_nav_port/mod.rs` (`rename_workspace`, `complete_workspace_rename`, `workspace_name`) |
| Service | tide-app | `crates/tide-app/src/application/services/workspace_service/mod.rs` (`rename_workspace`, `complete_workspace_rename`, `workspace_name`, `execute_workspace_context_menu_action`) |
| Service | tide-app | `crates/tide-app/src/application/services/workspace_infra_service/mod.rs` (`ensure_initial_workspace_seeded`, refactored `new_workspace`) |
| Service | tide-app | `crates/tide-app/src/application/services/file_tree_service/mod.rs` (split workspace branch out of `execute_context_menu_action`) |
| Boot | tide-app | `crates/tide-app/src/main.rs` (calls `ensure_initial_workspace_seeded` after `App::new()`) |
| Mouse | tide-app | `crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs` (right-click on Workspace rail item) |
| Keyboard | tide-app | `crates/tide-app/src/adapter/inward/keyboard_adapter/modal.rs` (`handle_workspace_rename_key`) |
| Text routing | tide-app | `crates/tide-app/src/adapter/inward/text_routing_adapter/mod.rs` (route to `workspace_rename.input`) |
| Render | tide-app | `crates/tide-app/src/adapter/outward/view/chrome/titlebar.rs` (InputLine over item rect when `workspace_rename` is active) |
| MCP | tide-app | `crates/tide-app/src/adapter/inward/cli_adapter/mcp.rs`, `commands.rs` (`tide_rename_workspace` ↔ `rename-workspace` ↔ `cli_rename_workspace`) |
| Tests | tide-app | `crates/tide-app/src/application/behavior_tests/workspace_behavior.rs`, `text_input_routing.rs`, `cli_workspace_routing.rs` |
