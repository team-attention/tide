# Spec: Terminal OSC Title / Bell / Clipboard (dropped engine events)

## Overview

### As-Is

- `alacritty_terminal` (the VT engine) emits a rich `Event` stream to
  `TermEventListener::send_event` (`domain/terminal/grid_sync.rs`), but the
  listener only handles `PtyWrite`, `ColorRequest`, `Notification` (OSC 9), and
  `PrivateModeUpdate(2031)`. Everything else falls into `_ => {}` and is dropped.
- Concretely dropped today:
  - `Event::Title(String)` / `Event::ResetTitle` — OSC 0 / OSC 2. The running
    program (shell prompt, `ssh`, `vim`, `tmux`) cannot set the terminal title.
  - `Event::Bell` — BEL (`\a`). No audible or visual bell ever fires.
  - `Event::ClipboardStore(ClipboardType, String)` — OSC 52 write. `tmux`/`vim`
    "copy to system clipboard" (notably over SSH) silently does nothing.
  - `Event::ClipboardLoad(ClipboardType, formatter)` — OSC 52 read. Programs
    cannot paste the system clipboard via escape sequence.
- The terminal has no concept of a program-set title: `TerminalContext` tracks
  cwd / git / shell-idle, but no OSC title string.

### To-Be

- **Title**: OSC 0/2 sets a per-`Terminal` title string; OSC `ResetTitle`
  clears it. The active terminal's title is reflected on the native macOS
  window (`NSWindow.setTitle`). Cleared title falls back to the default.
- **Bell**: `Event::Bell` rings the system bell (audible `NSBeep`) for the
  pane, routed through the existing platform-command channel.
- **OSC 52 write**: `ClipboardStore(Clipboard, text)` writes `text` to the
  system clipboard via `ClipboardPort`. `Selection` clipboard is treated as the
  same system pasteboard (macOS has no separate selection buffer).
- **OSC 52 read**: `ClipboardLoad` is implemented end-to-end but **gated by a
  policy flag that defaults to OFF**. A remote program must not be able to
  exfiltrate the clipboard silently. When enabled, the system clipboard text is formatted by the
  engine-supplied formatter and written back to the PTY. When disabled, the
  request is dropped (no response), which is the safe xterm behavior.

### Approach

1. Add shared sinks to `TermEventListener` for title / bell / clipboard-write /
   clipboard-read, mirroring the existing `notifications` queue pattern.
2. Handle the four events in `send_event`; mark dirty + wake so the main thread
   drains them on the next frame. Clipboard-read requests are queued only when
   the policy flag allows them.
3. Expose `drain_title`, `take_bell`, `drain_clipboard_writes`, and
   `drain_clipboard_loads` on `Terminal`.
4. Drain them in `event_loop_adapter` alongside `drain_notifications`:
   - title → store on `TerminalPane.context.osc_title`; for the active terminal,
     push a `WindowCommand::SetWindowTitle`.
   - bell → push `WindowCommand::Bell` (audible `NSBeep`).
   - clipboard write → `self.ports.clipboard.set_text`.
   - clipboard read → `self.ports.clipboard.get_text` → formatter → PTY write.
5. `WindowCommand::Bell` / `SetWindowTitle` handled by the platform window.

## Bounded Contexts

| Context | Role |
|---------|------|
| `domain/terminal` | New listener sinks + `Terminal` drain API + bell/title state |
| `domain/pane` | `TerminalContext.osc_title` field |
| `event_loop_adapter` | Per-frame drain → clipboard port + platform commands |
| `platform_adapter` | `WindowCommand::Bell` (NSBeep) + `SetWindowTitle` (setTitle) |

## Use Cases

### UC-1: Program sets the window title (OSC 0/2)
- Actor: running program. Trigger: emits `\e]0;TITLE\a` or `\e]2;TITLE\a`.
- Flow: engine → `Event::Title(TITLE)` → listener stores pending title →
  app drains → `TerminalContext.osc_title = Some(TITLE)`; active terminal sets
  native window title.
- BR-1: latest title wins (last-write-wins per drain).
- BR-2: `ResetTitle` clears `osc_title` to `None` (fall back to default).

### UC-2: Program rings the bell
- Actor: running program. Trigger: emits BEL (`\a`).
- Flow: engine → `Event::Bell` → listener sets bell-pending → app drains →
  `WindowCommand::Bell` → `NSBeep`.
- BR-3: bell-pending is edge-triggered: draining clears it; multiple bells in
  one frame ring once.

### UC-3: Program copies to the system clipboard (OSC 52 write)
- Actor: running program. Trigger: emits `\e]52;c;BASE64\a`.
- Flow: engine decodes base64 → `Event::ClipboardStore(Clipboard, text)` →
  listener queues → app drains → `ClipboardPort::set_text(text)`.
- BR-4: both `Clipboard` and `Selection` target the system pasteboard.

### UC-4: Program reads the system clipboard (OSC 52 read)
- Actor: running program. Trigger: emits `\e]52;c;?\a`.
- Flow: engine → `Event::ClipboardLoad(_, formatter)`.
- BR-5: if clipboard-read policy is OFF (default), the request is dropped (no
  PTY response).
- BR-6: if ON, the response `formatter(clipboard_text)` is written to the PTY.

## Invariants

- Dropped-event handling must not regress existing `Notification` / `ColorRequest`
  / `PrivateModeUpdate` behavior.
- No system-clipboard or AppKit call happens on the PTY thread; clipboard writes
  and reads are drained on the main thread.

## Tests

| UC | BR | Test |
|----|----|------|
| UC-1 | BR-1 | `title_event_sets_pending_title_last_wins` |
| UC-1 | BR-2 | `reset_title_event_clears_pending_title` |
| UC-2 | BR-3 | `bell_event_is_edge_triggered` |
| UC-3 | BR-4 | `clipboard_store_event_queues_text` |
| UC-4 | BR-5 | `clipboard_load_dropped_when_read_disabled` |
| UC-4 | BR-6 | `clipboard_load_responds_when_read_enabled` |

## Location

- `crates/tide-app/src/domain/terminal/grid_sync.rs` (listener sinks + handling)
- `crates/tide-app/src/domain/terminal/mod.rs` (drain API, state)
- `crates/tide-app/src/domain/terminal/tests.rs` (behavior tests)
- `crates/tide-app/src/domain/pane/mod.rs` (`osc_title`)
- `crates/tide-app/src/adapter/inward/event_loop_adapter/mod.rs` (drain wiring)
- `crates/tide-app/src/adapter/outward/platform_adapter/` (`Bell`, `SetWindowTitle`)
