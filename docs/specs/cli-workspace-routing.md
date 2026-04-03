# Spec: CLI Workspace Routing

## Overview

### As-Is

When an agent (e.g. Claude Code) sends MCP commands (`split-horizontal`, `open-browser`, `render-html`, etc.), they are dispatched by `App.handle_cli_command()` which operates on the **active Workspace** state (`self.layout`, `self.panes`, `self.focus`). The MCP bridge (`mcp.rs`) forwards the agent's tool arguments as-is to the gateway socket -- no workspace context is attached.

If the user switches Workspaces while the agent is thinking, the command lands in the wrong Workspace. For example:
1. Agent in Workspace 1 calls `tide_split_horizontal`
2. User switches to Workspace 2 while agent is thinking
3. The split happens in Workspace 2's layout (wrong Workspace)

The `cli_notify` function already handles cross-workspace pane lookup for notification dots (iterating `self.ws.workspaces` to find the pane), but all other command handlers only see the active Workspace's `self.panes`.

Key code locations:
- `adapter/inward/cli_adapter/commands.rs:31-66` -- `handle_cli_command()` dispatch, no workspace routing
- `adapter/inward/cli_adapter/mcp.rs:246-298` -- `mcp_tools_call()` forwards arguments without `_caller_pane`
- `adapter/inward/event_loop_adapter/mod.rs:406-421` -- `CliCommand` arm, calls `handle_cli_command` directly
- `application/services/workspace_infra_service/mod.rs:55-94` -- `save_active_workspace()` / `load_active_workspace()` raw swap
- `application/services/workspace_infra_service/mod.rs:113-162` -- `switch_workspace()` with side effects (IME commit, browser hide/show, file tree update)

### To-Be

CLI commands execute in the **caller's Workspace context**, regardless of which Workspace is currently active. The MCP bridge injects `_caller_pane` (from `TIDE_PANE` env var) into every command's params. The dispatch layer (`handle_cli_command`) uses `_caller_pane` to find which Workspace the caller belongs to, and if it differs from the active Workspace, temporarily swaps context using raw `save_active_workspace` / `load_active_workspace` (NOT `switch_workspace`, which has UI side effects).

```
Agent (TIDE_PANE=3)
  │
  ├─ tide mcp ─── injects _caller_pane: 3 ───┐
  │                                            ▼
  │                                   Gateway Socket
  │                                            │
  └────────────────────────────────────────────┘
                                               ▼
                          handle_cli_command()
                            1. Extract _caller_pane from params
                            2. Find workspace containing pane 3
                            3. If not active → save/load swap
                            4. Execute command
                            5. Swap back to original active
                            6. Return result
```

Transparent to agents. No MCP protocol changes. No new env vars.

### Approach

1. **MCP bridge injection**: In `mcp_tools_call()`, read `TIDE_PANE` from environment and inject `_caller_pane` into the params object before sending to the gateway socket.
2. **Workspace lookup**: Add a helper method `find_workspace_for_pane(pane_id) -> Option<usize>` that checks the active Workspace's `self.panes` first, then iterates stored `self.ws.workspaces[i].panes` for inactive Workspaces.
3. **Context swap in dispatch**: In `handle_cli_command()`, before dispatching to the command handler:
   - Extract and strip `_caller_pane` from params
   - Look up which Workspace it belongs to
   - If different from active: `save_active_workspace()`, set `ws.active = target`, `load_active_workspace()`
   - Execute command
   - If swapped: `save_active_workspace()`, set `ws.active = original`, `load_active_workspace()`
   - Use a scope guard or explicit finally block to guarantee restoration even on error
4. **Notify cross-workspace**: `cli_notify` already handles cross-workspace notification dots by iterating stored workspaces. For the `has_pane` check that currently drops notifications for inactive workspace panes, use the new `find_workspace_for_pane` to detect the pane exists before processing.

## Bounded Contexts

| Context | Role |
|---------|------|
| `cli_adapter` | MCP bridge injects `_caller_pane`; dispatch layer performs workspace context swap |
| `workspace_infra_service` | Provides `save_active_workspace` / `load_active_workspace` raw swap; new `find_workspace_for_pane` helper |
| `terminal` | PTY already exports `TIDE_PANE` env var (no change) |

## Use Cases

### UC-1: CLI command from agent in active Workspace (no swap needed)

- **Actor**: Agent process (via MCP bridge)
- **Trigger**: MCP tool call with `_caller_pane` that exists in the active Workspace
- **Precondition**: Agent's terminal pane is in the currently active Workspace
- **Flow**:
  1. MCP bridge reads `TIDE_PANE` env var, injects `_caller_pane` into params
  2. `handle_cli_command` extracts `_caller_pane`
  3. `find_workspace_for_pane` returns active Workspace index
  4. No swap needed; command executes normally
  5. `_caller_pane` is stripped from params before reaching the command handler
- **Postcondition**: Command executes in active Workspace; no workspace swap occurs
- **Business Rules**:
  - BR-5: `_caller_pane` is stripped from params before reaching command handlers

### UC-2: CLI command from agent in inactive Workspace (swap, execute, swap back)

- **Actor**: Agent process (via MCP bridge)
- **Trigger**: MCP tool call with `_caller_pane` that exists in an inactive Workspace
- **Precondition**: User has switched away from the agent's Workspace
- **Flow**:
  1. MCP bridge reads `TIDE_PANE` env var, injects `_caller_pane` into params
  2. `handle_cli_command` extracts `_caller_pane`
  3. `find_workspace_for_pane` returns a non-active Workspace index
  4. `save_active_workspace()` saves current active state
  5. `ws.active` set to target Workspace index
  6. `load_active_workspace()` loads target Workspace state into App fields
  7. Command handler executes against the target Workspace state
  8. `save_active_workspace()` saves modified target Workspace state back
  9. `ws.active` set to original Workspace index
  10. `load_active_workspace()` restores original Workspace state
- **Postcondition**: Command executed in the correct Workspace; active Workspace is unchanged from user's perspective
- **Business Rules**:
  - BR-1: If `_caller_pane` belongs to a non-active Workspace, commands execute in that Workspace's context
  - BR-2: Active Workspace must be restored after cross-workspace command execution, even on error
  - BR-4: Raw `save_active_workspace` / `load_active_workspace` is used (NOT `switch_workspace`) to avoid side effects like browser hide/show, IME commit, file tree update, and chrome invalidation
  - BR-5: `_caller_pane` is stripped from params before reaching command handlers

### UC-3: CLI command without `_caller_pane` (fallback to active Workspace)

- **Actor**: Shell script or manual `tide cli` invocation
- **Trigger**: CLI command without `_caller_pane` in params
- **Precondition**: None
- **Flow**:
  1. `handle_cli_command` checks for `_caller_pane` in params -- not found
  2. Command executes in the active Workspace (current behavior)
- **Postcondition**: Backward-compatible behavior preserved
- **Business Rules**:
  - BR-3: Commands without `_caller_pane` execute in the active Workspace (backward compatible)

### UC-4: CLI command with `_caller_pane` that doesn't exist in any Workspace

- **Actor**: Agent process whose terminal was closed while the agent was running
- **Trigger**: MCP tool call with `_caller_pane` referencing a pane that no longer exists
- **Precondition**: The terminal pane was closed (agent is still running as an orphaned process)
- **Flow**:
  1. MCP bridge injects `_caller_pane` into params
  2. `handle_cli_command` extracts `_caller_pane`
  3. `find_workspace_for_pane` returns `None` (pane not found in any Workspace)
  4. Falls back to active Workspace (same as UC-3)
  5. `_caller_pane` is stripped from params before reaching the command handler
- **Postcondition**: Command executes in active Workspace as fallback; no error returned for the routing itself
- **Business Rules**:
  - BR-3: Commands without a valid `_caller_pane` fall back to active Workspace
  - BR-5: `_caller_pane` is stripped from params before reaching command handlers

### UC-5: Notify command for pane in inactive Workspace

- **Actor**: Agent wrapper lifecycle hook
- **Trigger**: `notify` command with `pane` field referencing a pane in an inactive Workspace
- **Precondition**: User has switched Workspaces; agent is still running in the background
- **Flow**:
  1. `_caller_pane` triggers context swap to the agent's Workspace (UC-2 flow)
  2. `cli_notify` executes with the correct Workspace loaded -- `has_pane` now returns true
  3. Agent status is updated in `detected_agents`
  4. Context swaps back to the user's active Workspace
  5. Workspace notification dot is set on the agent's Workspace (existing `route_agent_notification` logic for inactive workspaces)
- **Postcondition**: Agent status is correctly updated; Workspace notification dot is visible
- **Business Rules**:
  - BR-1: Command executes in the pane's Workspace context
  - BR-2: Active Workspace is restored after execution

## Invariants

1. **Active Workspace restoration**: After any cross-workspace CLI command execution, `ws.active` and all App fields (layout, panes, focus, dock state) MUST be restored to the user's active Workspace. This holds even if the command handler returns an error or panics.
2. **No UI side effects on swap**: Cross-workspace context swap uses raw `save_active_workspace` / `load_active_workspace` only. It MUST NOT trigger IME commit, browser hide/show, file tree update, chrome invalidation, or `TIDE_WORKSPACE` env var update.
3. **Param transparency**: Command handlers never see `_caller_pane` in their params. The dispatch layer strips it before forwarding.
4. **PaneId sync maintained**: The save/load swap preserves the PaneId sync invariant (every PaneId in SplitLayout exists in App.panes and vice versa) because it swaps the entire layout+panes set atomically.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-5 | `cli_command_in_active_workspace_strips_caller_pane` |
| UC-2 | BR-1 | `cli_command_in_inactive_workspace_executes_in_correct_context` |
| UC-2 | BR-2 | `cli_command_in_inactive_workspace_restores_active_workspace` |
| UC-2 | BR-2 | `cli_command_in_inactive_workspace_restores_on_error` |
| UC-2 | BR-4 | `cross_workspace_swap_uses_raw_save_load_not_switch` |
| UC-2 | BR-5 | `caller_pane_stripped_before_handler_receives_params` |
| UC-3 | BR-3 | `cli_command_without_caller_pane_uses_active_workspace` |
| UC-4 | BR-3 | `cli_command_with_nonexistent_caller_pane_falls_back_to_active` |
| UC-5 | BR-1 | `notify_for_inactive_workspace_pane_updates_agent_status` |
| UC-5 | BR-2 | `notify_for_inactive_workspace_pane_restores_active_workspace` |

## Location

| Layer | Key Files |
|-------|-----------|
| **MCP bridge injection** | `adapter/inward/cli_adapter/mcp.rs` -- inject `_caller_pane` from `TIDE_PANE` env var in `mcp_tools_call()` |
| **Dispatch + swap** | `adapter/inward/cli_adapter/commands.rs` -- `handle_cli_command()` extract/strip `_caller_pane`, workspace context swap |
| **Workspace lookup** | `application/services/workspace_infra_service/mod.rs` -- `find_workspace_for_pane()` helper |
| **Raw swap** | `application/services/workspace_infra_service/mod.rs` -- existing `save_active_workspace()` / `load_active_workspace()` |
| **Tests** | `application/behavior_tests/cli_workspace_routing.rs` (new) |
