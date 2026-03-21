# Spec: Agent Gateway

Tide's built-in infrastructure for programmatic control and generative UI. Always on, always discoverable.

## Overview

### As-Is

- No IPC mechanism. External processes cannot query or control Tide.
- No way to display rich visual content beyond terminal escape sequences.
- No integration path for AI tools (Claude Code, Codex, Cursor, etc.).
- No visual indication of external connections or agent activity.
- WKWebView only uses `loadRequest:`. No `loadHTMLString`, no JS message bridge.
- Event loop: `mpsc::channel::<AppEvent>` with `Platform(PlatformEvent)` and `Wake` variants.

### To-Be

Agent Gateway is a built-in subsystem of Tide — always running, zero configuration needed. It has four layers:

```
┌─────────────────────────────────────────────────────────────┐
│                        TIDE APP                             │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Agent Gateway (always on)                          │   │
│  │                                                     │   │
│  │  1. Socket Server    ← Unix socket, JSON-RPC 2.0   │   │
│  │  2. CLI Client       ← `tide cli <cmd>`            │   │
│  │  3. MCP Server       ← `tide mcp` (stdio bridge)   │   │
│  │  4. Status Indicator ← chrome badge in UI           │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────┐  ┌─────────────────────────┐     │
│  │ Terminal Panes       │  │ Render Panes (Browser)  │     │
│  │ TIDE_SOCKET env var  │  │ loadHTMLString          │     │
│  │ TIDE_PANE env var    │  │ morphdom streaming      │     │
│  │                      │  │ window.tide.send bridge │     │
│  └─────────────────────┘  └─────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘

External integrations:

  Shell scripts ─── tide cli ──────┐
  Claude Code ──── tide mcp ───────┤──→ Unix Socket ──→ Gateway
  Cursor ────────── MCP config ────┤
  Custom agent ─── raw socket ─────┘
```

### Approach

1. **Socket server** (always on): Spawns on app startup. Listener thread enqueues `CliCommand` into existing `mpsc` channel. Zero config.
2. **CLI client** (`tide cli`): Subcommand of the `tide` binary. Connects to `$TIDE_SOCKET`, sends command, prints result.
3. **MCP server** (`tide mcp`): Subcommand that speaks MCP protocol over stdio, bridges to the Unix socket internally. Agents like Claude Code connect to this.
4. **Status indicator**: Chrome badge showing gateway state — socket listening, connected clients count, active render streams.
5. **Generative UI**: `render-html` and `render-stream` commands load HTML into render-mode Browser panes.

## Bounded Contexts

| Context | Role |
|---------|------|
| `tide-app` | Gateway lifecycle, command dispatch, status tracking |
| `input` | `AppEvent::CliCommand` as new event source |
| `terminal` | Grid capture, env vars (`TIDE_SOCKET`, `TIDE_PANE`) |
| `layout` | Layout tree serialization, split/resize |
| `pane` | Pane info, render-mode Browser pane |
| `platform` | Socket lifecycle, `loadHTMLString`, JS message bridge |

## Core Design

### Socket (always on)

```
Path:     $TMPDIR/tide-<pid>.sock
Symlink:  $TMPDIR/tide-latest.sock → most recent instance
Cleanup:  atexit + SIGTERM/SIGINT handler removes socket file
Stale:    On startup, check if existing socket's PID is alive; remove if dead
```

Every child PTY exports:
- `TIDE_SOCKET` — socket path → identifies which Tide instance
- `TIDE_PANE` — this terminal's PaneId → default target for commands
- `TIDE_WORKSPACE` — this terminal's workspace name → context for cross-workspace safety

These propagate through the process tree: Tide → shell → agent → `tide mcp`. No config needed.

### Pane Targeting & Workspace Safety

- Commands that accept `-t <pane_id>` default to `TIDE_PANE` when omitted (agent targets itself)
- `list-panes` defaults to active workspace; `--all` lists all workspaces
- Commands targeting a pane in a **non-active workspace** still work (Tide looks up the pane across all workspaces). This handles the case where the user switches workspace while the agent is still running in a background workspace.
- `TIDE_WORKSPACE` lets the agent know which workspace it belongs to, even after workspace switches

### Protocol

Line-delimited JSON-RPC 2.0 over Unix domain socket.

```json
→ {"jsonrpc":"2.0","id":1,"method":"list-panes","params":{}}
← {"jsonrpc":"2.0","id":1,"result":[{"id":1,"kind":"terminal",...}]}
← {"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"pane not found"}}
```

Subscriptions push notifications (no `id`):
```json
← {"jsonrpc":"2.0","method":"event","params":{"type":"focus-changed","pane_id":3}}
```

### Thread Model

```
tide cli / tide mcp / raw client ──── Unix Socket ────┐
                                                       │
Socket Thread ◄────────────────────────────────────────┘
  │ parse JSON-RPC
  │ send CliCommand { method, params, response_tx } into mpsc
  │ call combined_waker()
  ▼
App Event Loop (existing recv_timeout loop)
  │ match AppEvent::CliCommand { .. }
  │ process, build response
  │ response_tx.send(result)
  │ update gateway_status (connected count, etc.)
  ▼
Socket Thread → write response → client
```

### Integration Points

| What | Current State | Change |
|------|---------------|--------|
| `AppEvent` (`event_loop_adapter/mod.rs:19-24`) | `Platform`, `Wake` | Add `CliCommand { method, params, response_tx }` |
| App thread loop (`event_loop_adapter/mod.rs:86-163`) | Matches `Platform`, ignores `Wake` | Add `CliCommand` arm |
| PTY env (`terminal/mod.rs:641-663`) | TERM, COLORTERM, COLORFGBG | Add TIDE_SOCKET, TIDE_PANE |
| WKWebView (`webview.rs:294-298`) | Only `loadRequest:` | Add `load_html_string()` |
| JS eval (`webview.rs:620-641`) | Only `window.find()` | Add general `evaluate_js()` |
| JS bridge (`webview.rs:365-456`) | No WKScriptMessageHandler | Add `tide` handler in config |
| BrowserPane (`browser.rs`) | `url_input_focused` | Add `render_mode: bool` |
| Chrome | No gateway indicator | Add status badge |

## Use Cases

### UC-1: ListPanes

- **Actor**: External process
- **Trigger**: `tide cli list-panes`
- **Flow**:
  1. CLI sends `{"method":"list-panes"}`
  2. App iterates `app.panes`, computes layout rects
  3. Returns JSON array
- **Business Rules**:
  - BR-1: All panes in active Workspace listed
  - BR-2: Each pane: id, kind, title, rect, focused
  - BR-3: Terminal: cwd, shell_idle, pid
  - BR-4: Editor: file_path, dirty
  - BR-5: Render pane: title, streaming status

### UC-2: CapturePaneContent

- **Actor**: External process
- **Trigger**: `tide cli capture-pane [-t <id>] [--start <line>] [--end <line>]`
- **Business Rules**:
  - BR-6: Visible grid by default
  - BR-7: Negative start = scrollback
  - BR-8: Editor returns buffer or line range
  - BR-9: Browser/Launcher → error
  - BR-10: No `-t` → `TIDE_PANE`

### UC-3: SendKeys

- **Actor**: External process
- **Trigger**: `tide cli send-keys [-t <id>] <keys...>`
- **Business Rules**:
  - BR-11: Literals as-is to PTY
  - BR-12: Special names translated (Enter, Tab, C-c, etc.)
  - BR-13: Non-existent pane → error
  - BR-14: No `-t` → `TIDE_PANE`

### UC-4: GetLayout

- **Actor**: External process
- **Trigger**: `tide cli get-layout`
- **Business Rules**:
  - BR-15: Recursive JSON tree
  - BR-16: Leaves include TabGroup with active tab

### UC-5: LayoutManipulation

- **Actor**: External process
- **Trigger**: `tide cli split-vertical|split-horizontal|close-pane|focus-pane|resize-pane`
- **Business Rules**:
  - BR-17: `split` returns new PaneId
  - BR-18: `close-pane` follows pane-lifecycle spec
  - BR-19: `focus-pane` changes focus
  - BR-20: `resize-pane` adjusts split ratio

### UC-6: PaneCreation

- **Actor**: External process
- **Trigger**: `tide cli open-terminal [--cwd <path>]`, `open-editor <file>`, `open-browser <url>`
- **Business Rules**:
  - BR-21: Terminal accepts cwd
  - BR-22: Editor non-existent file → empty buffer
  - BR-23: Already-open file → dedup
  - BR-24: `--position`: `split-right` (default), `split-below`, `tab`

### UC-7: RenderHTML (Generative UI)

- **Actor**: AI agent or script
- **Trigger**: `echo '<h1>Hello</h1>' | tide cli render-html --title "Output"`
- **Flow**:
  1. CLI reads HTML from stdin, sends `{"method":"render-html","params":{"title":"..","html":".."}}`
  2. `--pane <id>`: replace existing render pane's content
  3. No `--pane`: create new render-mode Browser pane
  4. Inject **render runtime** into the page before loading agent HTML:
     - `morphdom` — DOM diffing for incremental updates
     - `window.tide.send(json)` — bridge for HTML→Tide communication
     - `window.tide.onMessage(callback)` — bridge for Tide→HTML communication
     - Tailwind CSS (CDN play script) — utility-first styling without build step
     - Tide theme CSS variables (`--tide-bg`, `--tide-fg`, `--tide-accent`, etc.) — synced from app theme
  5. Wrap agent HTML: `<div id="root">{agent html}</div>`
  6. Load via `loadHTMLString`
  7. Return pane_id
- **Postcondition**: HTML visible in Browser pane, interactive via bridge
- **Business Rules**:
  - BR-25: Loaded via `loadHTMLString` (no server)
  - BR-26: Render-mode: no URL bar, title in tab
  - BR-27: Re-render same pane_id replaces content (morphdom diff, preserves DOM state)
  - BR-28: Full web: script, style, SVG, Canvas, WebGL
  - BR-29: `window.tide.send(json)` bridge — HTML→agent communication
  - BR-30: Bridge messages arrive as `webview-message` events to subscribed clients
  - BR-31: Render runtime (morphdom, Tailwind, theme vars, bridge) pre-injected — agent HTML does not need to include them
  - BR-32: Tide theme CSS vars update live when user switches theme (dark↔light)

**Render Runtime** (injected into every render pane):

```html
<head>
  <script src="https://unpkg.com/morphdom@2/dist/morphdom-umd.min.js"></script>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    :root {
      --tide-bg: #1e1e2e;          /* synced from Tide theme */
      --tide-fg: #cdd6f4;
      --tide-accent: #89b4fa;
      --tide-surface: #313244;
      --tide-border: #45475a;
      --tide-success: #a6e3a1;
      --tide-warning: #f9e2af;
      --tide-error: #f38ba8;
    }
    body { background: var(--tide-bg); color: var(--tide-fg); font-family: system-ui; margin: 0; padding: 16px; }
  </style>
  <script>
    window.tide = {
      send: (msg) => window.webkit.messageHandlers.tide.postMessage(JSON.stringify(msg)),
      _listeners: [],
      onMessage: (cb) => window.tide._listeners.push(cb),
      _dispatch: (msg) => window.tide._listeners.forEach(cb => cb(msg)),
    };
  </script>
</head>
```

**Interaction feedback loop**:

```
Agent                          Tide                         User
  │                              │                            │
  ├─ render-html ───────────────→│ loadHTMLString             │
  │  (button + onclick handler)  │────────────────────────────→│
  │                              │                            │
  │                              │         user clicks button │
  │                              │◄───── tide.send({action})  │
  │◄── webview-message event ────│                            │
  │                              │                            │
  ├─ render-html --pane X ──────→│ morphdom diff (preserves   │
  │  (updated HTML)              │  scroll pos, input values) │
  │                              │────────────────────────────→│
```

### UC-8: RenderStream (Streaming Generative UI)

- **Actor**: AI agent
- **Trigger**: `tide cli render-stream --title "Agent Monitor"`
- **Flow**:
  1. Creates render-mode Browser pane with render runtime + empty `<div id="root">`
  2. Connection stays open; CLI sends chunks on the socket:
     ```json
     {"jsonrpc":"2.0","method":"stream-chunk","params":{"pane_id":5,"html":"<div>Step 1 done</div>"}}
     ```
  3. Each chunk: `evaluateJavaScript("morphdom(document.getElementById('root'), ...)")` — diffs against current DOM
  4. Preserves scroll position, input field values, focus state across updates
  5. Disconnect → pane stays open with final content
- **Postcondition**: Browser pane shows live-updating HTML
- **Business Rules**:
  - BR-33: Chunks are full HTML snapshots (morphdom diffs against current DOM)
  - BR-34: Render runtime pre-loaded (agent doesn't need to include morphdom/Tailwind)
  - BR-35: Disconnect keeps pane open
  - BR-36: Multiple simultaneous streams
  - BR-37: morphdom preserves scroll position, focus, and input values across updates

### UC-9: EventSubscription

- **Actor**: Long-running agent
- **Trigger**: `tide cli subscribe [--events <types>]`
- **Flow**:
  1. Connection stays open, server pushes JSON-RPC notifications
  2. Event types: `pane-created`, `pane-closed`, `focus-changed`, `layout-changed`, `output` (opt-in), `webview-message`
  3. Disconnect = unsubscribe
- **Business Rules**:
  - BR-38: Filtered by requested types
  - BR-39: `output` opt-in
  - BR-40: Disconnect unsubscribes
  - BR-41: Multiple subscribers

### UC-10: MCP Server

- **Actor**: AI tool (Claude Code, Cursor, etc.)
- **Trigger**: `tide mcp` (started by the AI tool's MCP config)
- **Flow**:
  1. `tide mcp` launches as a child process of the AI tool
  2. Reads MCP JSON-RPC requests from stdin, writes responses to stdout
  3. Internally connects to `$TIDE_SOCKET` (or `$TMPDIR/tide-latest.sock`)
  4. Translates MCP `tools/list` → returns tool schemas for all commands
  5. Translates MCP `tools/call` → sends JSON-RPC to socket → returns result
  6. Stateless bridge — no state of its own
- **Postcondition**: AI tool sees Tide's capabilities as native MCP tools
- **Business Rules**:
  - BR-42: `tide mcp` is a subcommand of the `tide` binary (no separate install)
  - BR-43: Exposes all CLI commands as MCP tools with JSON Schema parameters
  - BR-44: If `TIDE_SOCKET` not set, tries `$TMPDIR/tide-latest.sock`
  - BR-45: If socket not reachable, returns MCP error (not crash)
  - BR-46: Tool names prefixed with `tide_` (e.g., `tide_list_panes`, `tide_render_html`)

**MCP Tool Schemas** (exposed via `tools/list`):

```json
{
  "name": "tide_list_panes",
  "description": "List all panes in the active workspace with id, kind, rect, and focus status",
  "inputSchema": { "type": "object", "properties": {} }
}
{
  "name": "tide_capture_pane",
  "description": "Read text content from a terminal or editor pane",
  "inputSchema": {
    "type": "object",
    "properties": {
      "pane_id": { "type": "integer", "description": "Target pane ID (omit for self)" },
      "start": { "type": "integer", "description": "Start line (negative = scrollback)" },
      "end": { "type": "integer", "description": "End line" }
    }
  }
}
{
  "name": "tide_render_html",
  "description": "Render HTML content in a browser pane (generative UI)",
  "inputSchema": {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "html": { "type": "string" },
      "pane_id": { "type": "integer", "description": "Existing pane to update (omit for new)" }
    },
    "required": ["title", "html"]
  }
}
```

**Claude Code integration** (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "tide": { "command": "tide", "args": ["mcp"] }
  }
}
```

**Cursor integration** (`.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "tide": { "command": "tide", "args": ["mcp"] }
  }
}
```

### UC-11: GatewayStatus (Status Indicator + Integration Panel)

- **Actor**: User / System
- **Trigger**: Gateway state changes, or user clicks badge
- **Flow**:
  1. Gateway tracks:
     - Socket listening status
     - Connected socket clients (PID, connection duration)
     - Active render streams
     - **Agent processes** detected in terminal panes
  2. **Agent detection**: Periodically scan terminal panes' child process trees for known agent binaries.
     On macOS, use `libproc` (`proc_listchildpids` / `proc_pidpath`) to walk the process tree from the shell PID.
     Known agents:

     | Process name | Agent |
     |-------------|-------|
     | `claude` | Claude Code |
     | `codex` | OpenAI Codex CLI |
     | `aider` | Aider |
     | `cursor-agent` | Cursor (background agent) |
     | `copilot` | GitHub Copilot CLI |

     Detection result per terminal pane: `Option<AgentInfo { name, pid, gateway_connected: bool }>`
     - `gateway_connected`: true if this agent's PID (or child of it) matches a socket client PID.

  3. **Badge** in chrome:
     - **No agents running**: subtle dot, dimmed (gateway idle)
     - **Agent running, not connected**: icon with agent name (agent found but not using gateway)
     - **Agent running + connected**: lit icon (agent is using gateway)
     - **Streaming**: animated indicator
     - **Error**: red indicator (socket bind failed)
  4. **Terminal tab badge**: Each terminal pane with a detected agent gets a small agent icon/name in its tab chrome (similar to how git branch badges work). Shows at a glance "this terminal is running claude".

  5. Clicking the badge opens **GatewayModal** with four sections:

  **Section 1 — Active Agents**
  Per-terminal-pane agent status:
  ```
  Terminal %3 ── claude ── Connected (MCP) ── 2m ago
  Terminal %5 ── codex  ── Not connected    ── Running
  Terminal %7 ── (none) ── Shell idle
  ```
  - Each row shows: pane id, agent name (or "none"), connection status, duration
  - "Not connected" agents: show hint "This agent hasn't connected to Tide Gateway yet. Check its MCP config."
  - Click row → focus that terminal pane

  **Section 2 — Integrations Setup**
  Auto-detects installed AI tools and shows setup status + action buttons:

  | Tool | Detection | Config Path | Action |
  |------|-----------|-------------|--------|
  | Claude Code | `which claude` | `~/.claude/settings.json` | "Enable" / "Enabled ✓" |
  | Cursor | `~/.cursor/` exists | `.cursor/mcp.json` | "Enable" / "Enabled ✓" |
  | Windsurf | `~/.windsurf/` exists | `.windsurf/mcp.json` | "Enable" / "Enabled ✓" |
  | Shell | always | — | "Copy `tide cli` snippet" |

  "Enable" button writes the MCP config automatically:
  ```json
  {
    "mcpServers": {
      "tide": { "command": "tide", "args": ["mcp"] }
    }
  }
  ```
  - If config file exists: merge `tide` entry into existing `mcpServers` (preserve other servers)
  - If config file doesn't exist: create it with just the `tide` entry
  - After writing: button changes to "Enabled ✓" (with option to "Remove")

  **Section 3 — Render Panes**
  - List of all active render-mode Browser panes
  - Each entry: title, pane_id, status (streaming/static), source agent
  - "Focus" button → focuses the render pane
  - "Close" button → closes the render pane

  **Section 4 — Socket Info**
  - Socket path (copyable)
  - Raw connected clients list (PID, duration, last command)
  - Copyable shell snippet: `export TIDE_SOCKET=...` + example commands

- **Business Rules**:
  - BR-47: Badge always visible in chrome
  - BR-48: Badge reflects agent detection state, not just socket connections
  - BR-49: Agent detection via process tree scan (macOS `libproc`), runs on:
    - Modal open (immediate)
    - Terminal `shell_idle` state change (agent started/stopped)
    - Socket client connect/disconnect (correlate PID)
  - BR-50: Known agent list is hardcoded but extensible (config file later)
  - BR-51: `gateway_connected` correlates socket client PID with agent process PID (or parent chain)
  - BR-52: "Enable" merges config — never overwrites existing MCP server entries
  - BR-53: "Remove" only removes the `tide` entry, preserves everything else
  - BR-54: Terminal tab shows agent badge when agent process detected (small, like git branch badge)
  - BR-55: Error state shown when socket fails to bind
  - BR-56: If a tool's config already has `tide`, show "Enabled ✓" on modal open
  - BR-57: Agent detection does NOT continuously poll — triggered by specific events only

## Invariants

1. **Always on**: Socket server starts with the app, stops with the app. No toggle. No config.
2. **Socket lifecycle**: Created on startup, removed on exit (atexit + signal handler). Stale sockets from dead processes cleaned up.
3. **Single-threaded dispatch**: CliCommands processed in the app event loop — no new locks.
4. **Non-blocking**: Socket I/O never blocks the app event loop. Slow clients disconnected.
5. **Command parity**: CLI commands map to existing GlobalActions and methods. No divergent mutation paths.
6. **Render isolation**: Each render-mode Browser pane is independent.
7. **MCP stateless**: `tide mcp` is a pure bridge — all state lives in Tide.
8. **Env var guarantee**: Every PTY spawned by Tide has `TIDE_SOCKET` and `TIDE_PANE` set.

## Tests

| UC | BR | Test |
|----|-----|------|
| UC-1 | BR-1 | `list_panes_returns_all_active_workspace_panes` |
| UC-1 | BR-2 | `list_panes_includes_id_kind_title_rect_focused` |
| UC-1 | BR-3 | `list_panes_terminal_includes_cwd_and_shell_idle` |
| UC-1 | BR-5 | `list_panes_render_pane_includes_streaming_status` |
| UC-2 | BR-6 | `capture_pane_returns_visible_grid` |
| UC-2 | BR-7 | `capture_pane_negative_start_reads_scrollback` |
| UC-2 | BR-9 | `capture_pane_browser_returns_error` |
| UC-2 | BR-10 | `capture_pane_no_target_uses_tide_pane` |
| UC-3 | BR-11 | `send_keys_literal_writes_to_pty` |
| UC-3 | BR-12 | `send_keys_special_names_translated` |
| UC-3 | BR-13 | `send_keys_nonexistent_pane_error` |
| UC-4 | BR-15 | `get_layout_recursive_tree` |
| UC-4 | BR-16 | `get_layout_leaf_includes_tab_group` |
| UC-5 | BR-17 | `cli_split_returns_new_pane_id` |
| UC-5 | BR-19 | `cli_focus_pane_changes_focus` |
| UC-6 | BR-21 | `cli_open_terminal_with_cwd` |
| UC-6 | BR-23 | `cli_open_editor_dedup` |
| UC-7 | BR-25 | `render_html_uses_load_html_string` |
| UC-7 | BR-26 | `render_html_hides_url_bar` |
| UC-7 | BR-27 | `render_html_replaces_existing_pane` |
| UC-7 | BR-29 | `render_html_bridge_delivers_messages` |
| UC-7 | BR-31 | `render_html_runtime_preinjected` |
| UC-7 | BR-32 | `render_html_theme_vars_sync_on_theme_change` |
| UC-8 | BR-33 | `render_stream_morphdom_diffs` |
| UC-8 | BR-35 | `render_stream_disconnect_keeps_pane` |
| UC-8 | BR-37 | `render_stream_preserves_scroll_and_focus` |
| UC-9 | BR-38 | `subscribe_filters_by_type` |
| UC-9 | BR-40 | `disconnect_unsubscribes` |
| UC-10 | BR-42 | `mcp_is_tide_subcommand` |
| UC-10 | BR-43 | `mcp_tools_list_returns_all_commands` |
| UC-10 | BR-45 | `mcp_no_socket_returns_error` |
| UC-11 | BR-47 | `gateway_badge_visible_in_chrome` |
| UC-11 | BR-48 | `gateway_badge_reflects_agent_detection` |
| UC-11 | BR-49 | `gateway_detects_agent_process_in_terminal` |
| UC-11 | BR-51 | `gateway_correlates_socket_pid_with_agent` |
| UC-11 | BR-52 | `gateway_enable_merges_config_preserves_existing` |
| UC-11 | BR-53 | `gateway_remove_only_removes_tide_entry` |
| UC-11 | BR-54 | `terminal_tab_shows_agent_badge` |
| UC-11 | BR-55 | `gateway_badge_shows_error_on_bind_failure` |
| UC-11 | BR-56 | `gateway_shows_enabled_if_config_has_tide` |
| UC-11 | BR-57 | `gateway_agent_detection_not_continuous_poll` |

## Location

| Layer | Key Files |
|-------|-----------|
| **Socket server** | `adapter/inward/cli_adapter/mod.rs` (new) |
| **Protocol** | `adapter/inward/cli_adapter/protocol.rs` (new) |
| **Command handlers** | `adapter/inward/cli_adapter/commands.rs` (new) |
| **Render commands** | `adapter/inward/cli_adapter/render.rs` (new) |
| **MCP bridge** | `adapter/inward/cli_adapter/mcp.rs` (new) |
| **Gateway status** | `domain/state/gateway_status.rs` (new) |
| **Domain types** | `domain/core_types.rs` — CliCommand in AppEvent |
| **Event loop** | `adapter/inward/event_loop_adapter/mod.rs` — CliCommand arm |
| **CLI + MCP binary** | `main.rs` — `tide cli` and `tide mcp` subcommand branches |
| **PTY env** | `domain/terminal/mod.rs` — TIDE_SOCKET, TIDE_PANE |
| **WKWebView** | `adapter/outward/platform_adapter/macos/webview.rs` — loadHTMLString, bridge |
| **Browser pane** | `domain/pane/browser.rs` — render_mode flag |
| **Status chrome** | `adapter/outward/view/` — gateway badge rendering |
| **Tests** | `behavior_tests/agent_gateway.rs` (new) |

## Implementation Phases

### Phase 1 — Infrastructure + Observe
- Socket server (always on, startup/shutdown lifecycle)
- `CliCommand` in `AppEvent`, match arm in event loop
- `TIDE_SOCKET` + `TIDE_PANE` env vars in PTY spawning
- `tide cli` subcommand (connect, send, print)
- `list-panes` + `capture-pane` + `get-layout`
- Gateway status badge (socket listening indicator)

### Phase 2 — Act
- `send-keys` + `split` + `close-pane` + `focus-pane` + `resize-pane`
- `open-terminal` + `open-editor` + `open-browser`
- Badge: connected client count

### Phase 3 — Show (Generative UI)
- `loadHTMLString` on WKWebView
- `WKScriptMessageHandler` bridge
- `render-html` command + render-mode Browser pane
- `render-stream` command with morphdom
- Badge: active stream count

### Phase 4 — Discover + React
- `tide mcp` subcommand (MCP ↔ socket bridge)
- MCP tool schemas for all commands
- `subscribe` command + event emission
- Badge popover with integration snippets
- Integration docs for Claude Code / Cursor / Codex

### CLI Quick Reference

```bash
# Auto-available in every Tide terminal
echo $TIDE_SOCKET    # /tmp/tide-12345.sock
echo $TIDE_PANE      # 3

# Observe
tide cli list-panes
tide cli capture-pane                      # self
tide cli capture-pane -t 5 --start -100    # scrollback
tide cli get-layout

# Act
tide cli send-keys -t 3 "cargo test" Enter
tide cli send-keys C-c                     # Ctrl+C to self
tide cli split-vertical
tide cli open-editor src/main.rs
tide cli focus-pane -t 2

# Show
echo '<h1>Results</h1>' | tide cli render-html --title "CI"
tide cli render-html --pane 6 < updated.html
tide cli render-stream --title "Agent"     # stream on stdin

# React
tide cli subscribe --events focus-changed,pane-created

# MCP (used by AI tools, not humans)
tide mcp                                   # starts MCP stdio server
```
