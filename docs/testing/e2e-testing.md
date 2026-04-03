# E2E Testing Guide

## Overview

E2E tests launch a real Tide binary, drive it via the Agent Gateway Unix socket using JSON-RPC 2.0, and assert on the resulting application state. Unlike behavior tests (which test domain logic in-process), E2E tests exercise the full stack: platform init, window creation, PTY spawning, and gateway communication.

## How to Run

```bash
# Build Tide first
cargo build -p tide-app

# Run all E2E tests (no pipe!)
cargo test -p tide-e2e-tests 2>&1

# Run a specific test
cargo test -p tide-e2e-tests test_open_terminal 2>&1
```

**Never pipe output** (`| tail`, `| grep`, etc.) -- this causes zombie processes.

To use a custom binary path:

```bash
TIDE_BIN=/path/to/Tide cargo test -p tide-e2e-tests 2>&1
```

If `TIDE_BIN` is not set, the harness looks for `target/debug/Tide` relative to the workspace root.

## How It Works

1. `TestApp::launch()` creates an isolated `TempDir` and sets `HOME`, `TMPDIR`, and `XDG_CONFIG_HOME` to point into it.
2. Tide is spawned as a child process in that isolated environment.
3. The harness polls for a Unix socket at `$TMPDIR/tide-{pid}.sock` (up to 10 seconds).
4. Once connected, each `rpc_call()` opens a fresh `UnixStream`, writes one line of JSON-RPC 2.0, and reads one line back.
5. On `Drop`, the child process is killed and the temp directory is cleaned up.

Because each test gets its own `HOME` and `TMPDIR`, tests do not interfere with each other or with any running Tide instance.

## Anatomy of a Test

```rust
use tide_e2e_tests::assertions::{assert_pane_count, focused_pane_id};
use tide_e2e_tests::harness::TestApp;

#[test]
fn test_split_and_close() {
    // 1. Launch an isolated Tide instance
    let app = TestApp::launch().expect("failed to launch Tide");

    // 2. Drive it via gateway commands
    app.split_vertical(None).expect("split failed");
    assert_pane_count(&app, 2);

    // 3. Assert on state
    let id = focused_pane_id(&app);
    app.close_pane(id).expect("close failed");
    assert_pane_count(&app, 1);
}
```

Key pattern: launch, act, assert. Each test is independent -- no shared state between tests.

## Available Gateway Commands

These are exposed as convenience methods on `TestApp`. You can also call any command directly via `app.rpc_call("method-name", params)`.

| Method | `TestApp` method | Parameters | Description |
|--------|-----------------|------------|-------------|
| `list-panes` | `list_panes()` | none | List all panes in the active workspace |
| `open-terminal` | `open_terminal(cwd)` | `cwd?` | Open a new terminal pane (optionally with a working directory) |
| `split-vertical` | `split_vertical(pane_id)` | `pane_id?` | Split focused (or specified) pane vertically |
| `split-horizontal` | `split_horizontal(pane_id)` | `pane_id?` | Split focused (or specified) pane horizontally |
| `close-pane` | `close_pane(pane_id)` | `pane_id` | Close a specific pane |
| `focus-pane` | `focus_pane(pane_id)` | `pane_id` | Move focus to a specific pane |
| `send-keys` | `send_keys(pane_id, keys)` | `pane_id`, `keys` | Send key sequences to a terminal pane |
| `capture-pane` | `capture_pane(pane_id)` | `pane_id` | Capture the text content of a pane |
| `get-layout` | `get_layout()` | none | Get the SplitLayout tree of the active workspace |

For commands not yet wrapped as convenience methods, use `rpc_call` directly:

```rust
let result = app.rpc_call("some-command", json!({"key": "value"}))?;
```

## Assertion Helpers

All helpers are in `tide_e2e_tests::assertions`.

| Function | Description |
|----------|-------------|
| `assert_pane_count(app, n)` | Assert the workspace has exactly `n` panes |
| `assert_pane_focused(app, pane_id)` | Assert a specific pane is focused |
| `assert_pane_kind(app, pane_id, kind)` | Assert a pane has the expected `PaneKind` (e.g. `"Terminal"`) |
| `assert_pane_contains(app, pane_id, text)` | Assert captured pane content contains a substring |
| `focused_pane_id(app) -> u64` | Return the focused pane's ID (panics if none) |
| `pane_ids(app) -> Vec<u64>` | Return all pane IDs in the workspace |
| `wait_until(timeout, poll, desc, cond)` | Poll a condition until it becomes true or times out |

## Writing New Tests

1. Create a new test file in `crates/tide-e2e-tests/tests/` or add to an existing one.
2. Import the harness and assertion helpers:
   ```rust
   use tide_e2e_tests::harness::TestApp;
   use tide_e2e_tests::assertions::*;
   ```
3. Each `#[test]` function should call `TestApp::launch()` as its first line.
4. Use convenience methods to drive the app, then assert with helpers.
5. If testing terminal output (e.g., after `send_keys`), add a short sleep for PTY I/O latency:
   ```rust
   std::thread::sleep(Duration::from_millis(500));
   ```
6. For async conditions, prefer `wait_until` over a fixed sleep:
   ```rust
   wait_until(
       Duration::from_secs(5),
       Duration::from_millis(100),
       "pane count should reach 3",
       || pane_ids(&app).len() == 3,
   ).expect("condition not met");
   ```

## Debugging Tips

- **Enable logging**: `RUST_LOG=debug cargo test -p tide-e2e-tests 2>&1` to see Tide's internal logs.
- **Manual socket inspection**: After launching Tide manually, connect to the gateway socket with netcat:
  ```bash
  echo '{"jsonrpc":"2.0","id":1,"method":"list-panes","params":{}}' | nc -U /tmp/tide-XXXX.sock
  ```
- **Socket path**: Use `app.socket_path()` to get the socket path for a running test instance.
- **Process didn't start**: Check that `cargo build -p tide-app` completed successfully and the binary exists at `target/debug/Tide`.

## Isolation

Each `TestApp::launch()` creates a fresh `TempDir` and sets three environment variables to isolate the instance:

| Variable | Set to | Purpose |
|----------|--------|---------|
| `HOME` | temp dir | Prevents reading user config, shell profile, etc. |
| `TMPDIR` | temp dir | Socket and temp files go here; no collision with other instances |
| `XDG_CONFIG_HOME` | temp dir / `.config` | Prevents reading XDG-based config |

On drop, the child process is killed (`SIGKILL`) and the temp directory is removed. This guarantees no leftover state between tests or across runs.
