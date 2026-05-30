# Spec: Workbench Terminal Pane Session

## Scope

This spec adds a user-visible Workbench Terminal Pane session that can be opened
for the active Thread Execution Context.

It covers:

- `workbench.command` `open_terminal`.
- A Backend-owned Workbench Terminal process port separate from Agent Runtime
  and Provider Setup Surface ownership.
- Routing `write_terminal_input` to a running Workbench Terminal Pane.
- Bounded transcript preview updates through `workbench.changed` events.

It does not cover:

- Full terminal grid rendering, scrollback search, alternate-screen replay, or
  xterm.js integration.
- Agent Runtime PTY rendering.
- Shell command autocomplete.

## Evidence

- `docs_v2/implementation/electron-node-architecture-decisions.md` says
  Terminal Pane should be explicit and visible, separate from the hidden PTY
  used to run the Agent Runtime.
- `docs_v2/specs/tide-mcp-terminal-command-tool.md` already uses Terminal Pane
  state for bounded non-interactive command evidence, but that path does not
  give the user an interactive shell surface.
- `src/backend/application/services/thread-runtime-service.ts` currently routes
  `write_terminal_input` only to Provider Setup Surface handles.
- `src/backend/adapters/outbound/pty/python-pty-process-launcher.ts` already
  provides a PTY-capable process launcher that can back visible terminal
  sessions without coupling them to Agent Runtime.

## Decisions

### D1. Workbench Terminal has its own outward port

The Backend service uses `WorkbenchTerminalPort` for visible Terminal Pane
sessions. Provider Setup Surface keeps its own port because setup readiness has
different lifecycle behavior.

### D2. Default open uses the Thread root and default shell

`open_terminal` resolves `cwd` against the Thread root. If no command is passed,
the Backend uses a configured default shell command.

### D3. Transcript is bounded preview state

This slice stores only a bounded `transcriptPreview` on the Terminal Pane. Full
terminal grid state is deferred.

## Flow

### UC-1: Open visible terminal

1. User chooses Terminal from the Workbench Launcher.
2. Desktop emits `workbench.command` `open_terminal`.
3. Backend resolves the terminal cwd inside the Thread root.
4. Backend creates or reveals a Terminal Pane and starts a Workbench Terminal
   process.
5. Terminal output updates the Pane transcript preview and emits
   `workbench.changed`.

### UC-2: Send terminal input

1. User types input in the visible Terminal Pane.
2. Desktop emits `write_terminal_input` with raw terminal bytes.
3. Backend writes the bytes to the matching Workbench Terminal handle.

## Invariants

1. Workbench Terminal input never writes to the Agent Runtime.
2. Provider Setup Surface input keeps its existing readiness-specific behavior.
3. `open_terminal` cannot escape the Thread root.
4. Closing a running Workbench Terminal Pane stops its terminal handle.

## Tests

| Rule | Test |
|------|------|
| Backend opens visible terminal | `opening_workbench_terminal_starts_thread_scoped_terminal_pane` |
| Terminal input routes to Workbench Terminal handle | `workbench_terminal_input_writes_to_visible_terminal_handle` |
| Launcher Terminal action emits command | `product_shell_launcher_terminal_action_emits_open_terminal_command` |
| Real PTY terminal runs a live command and reports exit | `workbench_terminal_pty_port_runs_a_live_command_and_reports_exit` |
| Real PTY terminal accepts interactive input | `workbench_terminal_pty_port_accepts_interactive_input` |
| Terminal output streams as delta chunks to the renderer | `workbench_terminal_output_async_event_maps_to_a_streaming_contract_event` |

## Implementation Notes

- Reuse the PTY launcher adapter behind a Workbench-specific outward port.
- Keep UI rendering as bounded transcript preview plus input controls until the
  terminal grid renderer is specified.
