# Spec: Tide MCP Terminal Command Tool

## Scope

This spec adds the first Terminal Pane command tool to Tide MCP Tool Surface.

It covers:

- Running a bounded non-interactive command in the active Thread Execution Context.
- Capturing stdout, stderr, exit code, signal, and timeout state.
- Creating or refreshing a visible Terminal Pane for the command result.
- Returning a structured command result to the Agent.
- Rendering structured command results as `command_run` Agent Session Blocks.

It does not cover:

- A fully interactive Terminal Pane.
- Shell string execution.
- Background long-running task management.
- Provider Setup Surface input.
- User approval UI for command execution.
- Streaming command output to Desktop before the command exits.

## Evidence

- `docs_v2/glossary.md` defines Workbench Pane, Terminal Pane, Execution Context, Tide MCP Tool Surface, and Agent Session Block.
- `docs_v2/master-plan.md` says Workbench can contain a Terminal Pane for direct commands when needed, and that Workbench panes/views attach to the active Thread.
- `docs_v2/implementation/concrete-design-backlog.md` lists "open Terminal Pane when explicitly needed" in initial Tide MCP tool groups and chooses Tide-owned MCP tools over external shell delegation.
- `docs_v2/implementation/agent-session-rendering.md` includes `command_run` in the Agent Session Block vocabulary.
- `src/backend/application/services/thread-runtime-service.ts` already stores Terminal Pane state for Provider Setup Surface, but that path is provider setup specific.

## Decisions

### D1. First command tool is non-interactive

The first command tool is:

- `tide_run_terminal_command`

It runs a command with an argv array. It does not run through a shell string.

### D2. Command cwd is Thread-root scoped

The command runs in:

- Project Thread: `ThreadScope.project.cwd`.
- Scratch Thread: `ThreadScope.scratch.scratchCwd`.

Optional `cwd` is allowed only when it resolves inside the active Thread root.

### D3. Non-zero exit is a structured command result

Non-zero exit is not a service error. It returns a successful tool result with:

- `status: "failed"`
- `exitCode`
- stdout/stderr previews

Service errors are reserved for invalid input, missing Execution Context, unavailable command port, or outside-root cwd.

### D4. Output is bounded

The command result captures bounded stdout, stderr, and combined transcript preview.

If output exceeds the limit, the result marks `truncated: true`.

### D5. Terminal Pane is visible evidence

Each command result creates a visible Terminal Pane by default. Reuse can be added later, but first slice creates one Terminal Pane per command run to preserve visible evidence.

The Pane is attached to the Thread Workbench and does not represent the hidden Agent Runtime.

### D6. Structured command results render as command_run blocks

When an Agent Runtime emits a structured `tool_result` for `tide_run_terminal_command`, the Agent Session reader may render it as `command_run`.

Unknown provider-native command output remains raw/tool fallback.

## Domain Model

```ts
interface WorkspaceCommandRun {
  command: string;
  args: string[];
  cwd: string;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  transcript: string;
  truncated: boolean;
  timedOut: boolean;
  startedAt: string;
  completedAt: string;
}
```

```ts
interface TerminalPaneState {
  paneId: string;
  kind: "terminal";
  title: string;
  command?: string;
  args?: string[];
  cwd?: string;
  status: "ready" | "running" | "completed" | "failed";
  transcriptPreview?: string;
  exitCode?: number | null;
  signal?: string | null;
  timedOut?: boolean;
}
```

## Contracts

### Tool input

```ts
{
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  byteLimit?: number;
}
```

### Tool output

```ts
{
  kind: "run_terminal_command";
  threadId: string;
  pane: TerminalPaneRef;
  command: string;
  args: string[];
  cwd: string;
  status: "completed" | "failed";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  transcript: string;
  truncated: boolean;
  timedOut: boolean;
}
```

## Flow

### UC-1: Run a command

1. Agent calls `tide_run_terminal_command`.
2. Backend resolves the active Thread from MCP Session.
3. Backend validates command input and cwd under Thread root.
4. Backend runs the command through a Backend outward command port.
5. Backend creates a visible Terminal Pane with bounded transcript.
6. Backend returns the structured command result.

### UC-2: Non-zero exit stays visible

1. Command exits non-zero.
2. Backend returns a successful tool result with failed status and stderr/stdout previews.
3. Terminal Pane status is `failed`.

### UC-3: Reject outside-root cwd

1. Agent calls command tool with a cwd outside Thread root.
2. Backend returns `workspace_command_outside_scope`.
3. Backend does not run the command and does not mutate Workbench.

### UC-4: Render structured command result

1. Agent Runtime emits a structured `tool_result` for `tide_run_terminal_command`.
2. Agent Session reader sees output kind `run_terminal_command`.
3. Reader emits a `command_run` block.

## Invariants

1. Command cwd resolves inside the active Thread root.
2. Desktop never spawns command processes.
3. Command tool execution does not create or resume a second Agent Runtime.
4. Command output entering Thread state is bounded.
5. Non-zero exit remains visible as a command result, not a hidden exception.
6. Terminal Pane for command runs is separate from Provider Setup Surface Terminal Pane.

## Tests

| Rule | Test |
|------|------|
| Tool list includes command tool | `tide_mcp_tool_surface_lists_bounded_workbench_tools` |
| Command success creates completed Terminal Pane | `running_terminal_command_creates_completed_terminal_pane` |
| Command failure creates failed Terminal Pane | `running_terminal_command_with_nonzero_exit_returns_failed_result` |
| Outside-root cwd is rejected without mutation | `running_terminal_command_outside_thread_root_is_rejected` |
| Structured command result renders command_run block | `structured_command_tool_result_renders_command_run_block` |

## Implementation Notes

- Add `WorkspaceCommandPort` under Backend outward ports.
- Use Node `spawn` without `shell: true` for the first slice.
- Keep timeout, output byte limit, and cwd resolution in the port/service boundary.
- Later interactive Terminal Pane work can reuse or extend this model, but should not overload Provider Setup Surface.
