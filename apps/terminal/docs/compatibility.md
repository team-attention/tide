# Compatibility Diagnostics

Tide Terminal has headless compatibility diagnostics for the documented terminal
and workbench contracts. They run without opening the GUI and exit non-zero if
any fixture fails.

Terminal contract:

```bash
cargo run -p tide-app -- compatibility terminal
```

Workbench/MCP contract:

```bash
cargo run -p tide-app -- compatibility workbench
```

For machine-readable output, add `--json`:

```bash
cargo run -p tide-app -- compatibility terminal --json
cargo run -p tide-app -- compatibility workbench --json
```

## Terminal Fixtures

The terminal target covers:

| Fixture | What it proves |
| --- | --- |
| `terminal_search` | Visible terminal text is searchable. |
| `plain_url_detection` | HTTP/HTTPS text produces URL ranges. |
| `osc8_hyperlink` | OSC 8 URI metadata is preserved. |
| `ansi_color` | ANSI named colors survive grid sync. |
| `osc_title` | OSC 0/2 title changes are queued. |
| `bel` | BEL toggles terminal bell state. |
| `osc52_clipboard_write` | OSC 52 clipboard writes are decoded. |
| `sgr_mouse_reporting` | Mouse reporting uses SGR coordinates. |
| `wheel_forwarding` | Wheel events forward to mouse-reporting TUIs. |
| `kitty_keyboard` | Kitty keyboard mode encodes keys with CSI u. |
| `term_env` | Tide advertises `TERM=xterm-256color` and `COLORTERM=truecolor`. |

## Workbench Fixtures

The workbench target covers:

| Fixture | What it proves |
| --- | --- |
| `mcp_tool_contract` | MCP tools expose workspace observe, terminal observe/find, pane, browser, selection, and Context Artifact surfaces. |
| `observe_workspace_surfaces` | `observe-workspace` reports Stage, Terminal Context Surface, and Pane membership. |
| `browser_runtime_router` | Browser Runtime Router defaults to Tide Browser Pane Runtime and exposes explicit External Browser Runtime handoffs through MCP state. |
| `workspace_task_monitor` | `observe-workspace` includes caller-scoped task state with pane, agent, attention panel, agent resume policy, Terminal Context Surface, Browser, Diff, terminal-exit, restore, last-event, and Context Artifact delivery summaries. |
| `observe_terminal_surface` | `observe-terminal` exposes the caller Terminal's visible output, cursor, grid, and selection state. |
| `find_terminal_scrollback` | `find-in-terminal` searches caller Terminal scrollback and visible output with bounded results. |
| `caller_scoped_list_panes` | `list-panes` is scoped to the caller Terminal's workbench boundary. |
| `open_browser_context_surface` | `open-browser` creates a Browser Pane owned by the caller Terminal Context Surface. |
| `context_artifact_round_trip` | Context Artifacts can be created from a selection, delivered with history, listed, and read by the paired agent. |

## Scope

These diagnostics are deterministic product smokes. They do not yet replace real
TUI application fixtures, graphics protocol fixtures, live browser automation
checks, or manual UX testing in a visible Tide window.
