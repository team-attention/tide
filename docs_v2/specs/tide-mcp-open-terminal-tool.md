# Spec: Tide MCP Open Terminal Tool

## Overview

### As-Is

The Tide MCP Tool Surface exposes bounded Workbench tools for observing Thread
and Workbench state, opening Browser and Editor Panes, editing files into Diff
Panes, and running non-interactive terminal commands.

The Workbench already has a visible Terminal Pane command for user-triggered
Launcher actions, but an Agent cannot ask Tide to open the same interactive
Terminal Pane through MCP.

### To-Be

Agents can call `tide_open_terminal` to create or reveal a visible interactive
Terminal Pane in the owning Thread Workbench.

The tool uses the Thread root as the Execution Context boundary, resolves an
optional cwd inside that root, starts the same Workbench Terminal Port used by
Desktop Workbench commands, and returns a bounded Terminal Pane ref.

### Approach

1. Add `tide_open_terminal` to the Tide MCP Tool Surface list.
2. Add a service output shape for the visible Terminal Pane open result.
3. Reuse Backend Workbench terminal creation and PTY startup code.
4. Preserve composer focus for Agent-triggered MCP calls.
5. Add behavior tests for tool listing and Terminal Pane creation.

## Bounded Contexts

- Backend Thread Runtime Service owns Thread-scoped Workbench mutation.
- Workbench owns Terminal Pane state and refs.
- Workbench Terminal Port owns visible Terminal PTY startup.
- Tide MCP Tool Surface exposes Agent-callable Workbench tools.

## Use Cases

### UC-1: Agent opens a visible Terminal Pane

- Actor: Agent Runtime through Tide MCP Tool Surface.
- Trigger: Agent calls `tide_open_terminal`.
- Precondition: MCP Session resolves to an active Thread with a Thread root.
- Flow:
  1. Backend resolves the MCP Session to the owning Thread.
  2. Backend resolves optional cwd inside the Thread root.
  3. Backend creates or reveals a visible Terminal Pane.
  4. Backend starts the visible Terminal through Workbench Terminal Port.
  5. Backend returns an `open_terminal` result with the Terminal Pane ref.
- Postcondition: Workbench contains a visible Terminal Pane and composer focus
  is preserved.

Business Rules:

- BR-1: The tool must not create or resume an Agent Runtime.
- BR-2: The tool must reject cwd outside the Thread root.
- BR-3: Agent-triggered terminal open preserves Workbench `focusOwner` as
  `composer`.

## Invariants

1. `tide_open_terminal` only mutates the owning Thread Workbench.
2. Terminal cwd resolution stays inside the Thread root.
3. Terminal Pane refs expose bounded visible state, not raw PTY handles.

## Tests

| Use Case | Business Rule | Test |
| --- | --- | --- |
| UC-1 | BR-1, BR-3 | `opening_visible_terminal_from_mcp_creates_running_terminal_pane` |
| UC-1 | Tool list exposure | `tide_mcp_tool_surface_lists_bounded_workbench_tools` |

## Location

- `src/backend/application/domains/workbench/workbench.ts`
- `src/backend/application/services/thread-runtime-service.ts`
- `tests/tide-mcp-workbench-observe-open-browser.test.ts`
