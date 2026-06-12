# Spec: Tide MCP Workbench Mutation Events

## Scope

This spec makes Agent-initiated Tide MCP Workbench mutations visible to Desktop.

It covers:

- Emitting a Backend async `workbench_changed` event after successful Tide MCP
  tools mutate Workbench state.
- Keeping observe/read-only tools silent.
- Reusing the existing `workbench.changed` BackendEvent projection so Desktop
  applies the same Workbench Pane DTOs no matter whether the mutation came from
  the user or the Agent.

It does not cover browser click/type automation, Browser Page Map capture, or a
new Desktop command channel.

## Evidence

- `docs_v2/implementation/concrete-design-backlog.md` selects Tide-owned MCP
  tools so Agents operate Tide-owned surfaces instead of external browser or
  shell delegation.
- `docs_v2/specs/tide-mcp-workbench-observe-open-browser.md` says MCP tools have
  visible side effects and that `tide_open_browser` creates or reveals a visible
  Browser Pane.
- `src/backend/application/services/thread-runtime-service.ts` mutates Thread
  Workbench state for tools such as `tide_open_browser`, `tide_open_file`,
  `tide_edit_file`, `tide_go_to_definition`, `tide_open_terminal`, and
  `tide_run_terminal_command`.
- `src/backend/infrastructure/node/live/live-backend.ts` already projects
  `workbench_changed` async events into `workbench.changed` BackendEvents.

## Decisions

### D1. Backend emits after successful mutating tools

After a mutating Tide MCP tool succeeds, Backend emits a `workbench_changed`
async event with the updated Thread snapshot.

### D2. Read-only tools stay silent

`tide_observe_thread`, `tide_observe_workbench`, `tide_observe_browser`, and
`tide_read_file` do not emit Workbench events.

### D3. Desktop sees the same contract path

The async event uses the existing `workbench.changed` contract projection. No
Desktop-only MCP event path is added.

## Flow

### UC-1: Agent opens a Browser Pane

1. Agent calls `tide_open_browser`.
2. Backend mutates the owning Thread Workbench.
3. Backend returns the tool output.
4. Backend emits `workbench_changed`.
5. Desktop receives `workbench.changed` and renders the Browser Pane.

### UC-2: Agent observes Workbench

1. Agent calls `tide_observe_workbench`.
2. Backend returns a bounded snapshot.
3. Backend emits no Workbench event.

## Invariants

1. Mutating MCP tools have one visible Workbench event after success.
2. Failed MCP tool calls do not emit Workbench mutation events.
3. Observe/read-only MCP tools do not emit Workbench mutation events.
4. MCP events use Thread-scoped Workbench snapshots.

## Tests

| Rule | Test |
|------|------|
| Mutating MCP tool emits event | `mcp_mutating_workbench_tool_emits_workbench_changed_async_event` |
| Observe MCP tool stays silent | `mcp_observe_tool_does_not_emit_workbench_changed_async_event` |

## Implementation Notes

- Keep mutation classification next to `handleTideMcpToolCall`.
- Do not emit from `handleWorkbenchCommand`; Desktop command responses already
  return `workbench.changed` through the contract adapter.
