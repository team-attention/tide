# E2E Tests

The end-to-end tests live in `crates/tide-e2e-tests`. They launch the **real**
`tide-terminal` binary in an isolated `HOME`/`TMPDIR` and drive it over the Agent
Gateway Unix socket (line-delimited JSON-RPC 2.0) — the same API Wrapped Agents
use. This exercises real wiring (window, app thread, gateway, PTY) that the
in-process behavior tests (`application/behavior_tests/`) deliberately stub out.

## Running

```bash
cd apps/terminal
./scripts/e2e.sh            # builds the binary, runs the e2e lane serially
./scripts/e2e.sh test_focus_pane   # extra args pass through to the test filter
```

The tests are marked `#[ignore]`, so a plain `cargo test` stays **window-free**
(it would otherwise spawn a real app window per test and fail on a display-less
CI). `scripts/e2e.sh` opts them in with `--ignored --test-threads=1`.

The harness finds the binary via `TIDE_TERMINAL_BIN`, falling back to
`target/debug/tide-terminal`.

## Two test tiers — when to use which

| Tier | Location | Use for |
|------|----------|---------|
| **Behavior test** | `crates/tide-app/src/application/behavior_tests/` | Business-rule logic against `App` + `Ports::noop()`. Fast, deterministic, no window. **Default — most tests go here.** |
| **E2E test** | `crates/tide-e2e-tests/` | Real wiring that the in-process tier can't reach: gateway round-trips, PTY output, window/app-thread integration, multi-process behavior. |

If a rule can be proven against `App` directly, write a behavior test. Reserve
E2E for things that are only true once the real binary, socket, and OS are in the
loop.

## Flake policy

The PTY round-trip and rendering are asynchronous. **Never assert immediately
after an action that takes effect asynchronously** (e.g. `send_keys` →
`capture_pane`). Poll instead:

- `wait_until(timeout, interval, desc, || predicate)` — generic polling wait.
- `wait_for_pane_contains(&app, pane_id, needle)` — poll `capture_pane` until the
  content appears (panics with the last capture on timeout).

Run the e2e lane serially (`--test-threads=1`); the v2 release pipeline already
learned that real-PTY tests flake under parallel load. CI should retry the lane
once before failing.

## Gateway Test Driver (blueprint §E-1)

The driver's gateway methods are gated at runtime by `TIDE_TERMINAL_TEST_DRIVER=1`
(set by the harness's `launch`); they are inert otherwise. (A future
`#[cfg(feature = "test-driver")]` gate would also keep them out of the compiled
release binary — the hardening step.)

**Implemented:**

- **`test-poll-state`** → returns app-thread quiescence flags (`needs_redraw`,
  `animating`, `idle`) so the harness can wait for idle instead of polling
  observable side effects. Read-only; runs on the app thread between event
  batches. Harness: `app.poll_state()` and `app.wait_for_idle(timeout)`.

**Still deferred:**

- **`test-await-idle { quiet_ms, timeout_ms }`** → a deferred response fulfilled
  from the event-loop tick once the app has been quiescent for `quiet_ms`. Reuses
  the `subscribe` deferred-channel pattern (`CliCommand.notification_tx`).
- **`test-inject-event { event }`** → deserializes a `PlatformEvent`
  (Key/Modifiers/Mouse/Scroll/IME) and feeds it through the **same** `event_tx`
  the macOS callback uses, so the whole input stack (Modal → FocusArea → Router →
  TextInput; Architecture Invariants #4/#6) gets real E2E coverage without macOS
  accessibility permissions. Requires a feature-gated `serde` derive on
  `PlatformEvent` and routing the command where the event loop holds the window.
- **`test-screenshot { path }`** → render-thread WGPU readback to PNG, for visual
  regression artifacts on failure.
- **`test-quit`** → graceful shutdown (Drop-kill stays as the fallback).

First E2E targets once the driver lands (blueprint §E-5): input-routing priority
(Invariant #4), IME proxy lifecycle (Invariant #6), workspace-swap CLI routing,
the P-1/P-5 "UI never freezes" regression guards, and Wrapped-Agent status chrome
via a fake-agent fixture.
