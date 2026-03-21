# Spec: OSC 9 Terminal Notification

## Overview

### As-Is
Agent status (Running/Idle/NeedsInput) is reported exclusively through lifecycle hooks that call `tide notify` CLI subcommand. This requires wrapper scripts to inject hooks into each agent. Programs that don't support hooks (or aren't known to Tide) cannot report status.

### To-Be
Any program running in a Tide terminal can report status via OSC 9 escape sequence (`ESC ] 9 ; <message> BEL`). Tide parses the message and routes `tide:` prefixed messages to AgentStatus updates. This provides a universal, hook-free notification path.

### Approach
1. Fork vte 0.15.0 into `crates/vte/`, add `[patch.crates-io]`
2. Add `osc_notification(&mut self, message: &str)` to vte's `Handler` trait
3. Add `b"9"` case in `Performer::osc_dispatch` to call the new method
4. Implement in alacritty_terminal `Term<T>`: emit `Event::Notification(String)`
5. Handle in tide-app's `TermEventListener`: parse `tide:` prefix and update AgentStatus

## Bounded Contexts
- **terminal** (`domain/terminal/`) — handle Notification event from PTY
- **gateway** (`domain/state/gateway_status.rs`) — update AgentStatus (existing path)

## Use Cases

### UC-1: ParseOSC9
- **Actor**: Terminal PTY (byte stream from child process)
- **Trigger**: Child process writes `ESC ] 9 ; <message> BEL` or `ESC ] 9 ; <message> ST`
- **Precondition**: vte parser is processing the byte stream
- **Flow**:
  1. vte state machine enters OscString state on `ESC ]`
  2. On terminator (BEL or ST), `Performer::osc_dispatch` is called with params
  3. `b"9"` case extracts message from params[1..] joined by `;`
  4. Calls `self.handler.osc_notification(&msg)`
  5. `Term<T>::osc_notification` emits `Event::Notification(msg)`
- **Postcondition**: Event is queued for the event listener
- **Business Rules**:
  - BR-1: Message is UTF-8 decoded; invalid UTF-8 bytes are skipped (same as OSC 0/2 title handling)
  - BR-2: Empty message (no params beyond `9`) is silently ignored
  - BR-3: Both BEL (`\x07`) and ST (`ESC \`) terminators are supported

### UC-2: RouteNotification
- **Actor**: TermEventListener (tide-app)
- **Trigger**: `Event::Notification(message)` received
- **Precondition**: Terminal pane exists for this event listener
- **Flow**:
  1. Check if message starts with `tide:`
  2. If `tide:agent-running` → set AgentStatus::Running on this pane
  3. If `tide:agent-needs-input` → set AgentStatus::NeedsInput on this pane
  4. If `tide:agent-idle` → set AgentStatus::Idle on this pane
  5. If `tide:` with unknown suffix → log and ignore
  6. If no `tide:` prefix → ignore (future: system notification)
  7. Bump chrome_generation for tab dot update
- **Postcondition**: AgentStatus updated, tab dot reflects new state
- **Business Rules**:
  - BR-1: `tide:agent-running` → `AgentStatus::Running`
  - BR-2: `tide:agent-needs-input` → `AgentStatus::NeedsInput`
  - BR-3: `tide:agent-idle` → `AgentStatus::Idle`
  - BR-4: Unknown `tide:` messages are logged at debug level, not errors
  - BR-5: Non-`tide:` messages are silently ignored (no-op for now)
  - BR-6: If no detected agent exists for this pane, create a synthetic AgentInfo with name "Unknown" and the status

## Invariants
1. OSC 9 parsing does not affect any other OSC handling (0, 2, 4, 8, 10-12, 22, 50, 52, 104, 110-112)
2. `Event::Notification` follows the same thread safety model as other events (send via event_proxy)
3. Invalid OSC 9 sequences do not crash or panic — they are silently dropped

## Tests

| UC | BR | Test function |
|----|-----|---------------|
| UC-2 | BR-1 | `osc9_agent_running_updates_status()` |
| UC-2 | BR-2 | `osc9_agent_needs_input_updates_status()` |
| UC-2 | BR-3 | `osc9_agent_idle_updates_status()` |
| UC-2 | BR-4 | `osc9_unknown_tide_message_ignored()` |
| UC-2 | BR-5 | `osc9_non_tide_message_ignored()` |
| UC-2 | BR-6 | `osc9_creates_synthetic_agent_if_none_detected()` |

## Location

| Module | Path | Change |
|--------|------|--------|
| vte (fork) | `crates/vte/src/ansi.rs` | Add `osc_notification` to Handler trait, add `b"9"` case |
| alacritty_terminal | `crates/alacritty_terminal/src/event.rs` | Add `Event::Notification(String)` variant |
| alacritty_terminal | `crates/alacritty_terminal/src/term/mod.rs` | Implement `osc_notification` on Handler impl |
| terminal | `crates/tide-app/src/domain/terminal/mod.rs` | Handle `Event::Notification` in `TermEventListener` |
| workspace Cargo.toml | `Cargo.toml` | Add `vte = { path = "crates/vte" }` to `[patch.crates-io]` |
