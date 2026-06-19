# Terminal Capabilities

This page is the current public-facing capability matrix for Tide Terminal's
terminal surface. It is a product confidence document, not a full conformance
claim. A capability is only marked present when there is a clear code path or
checked-in spec behind it.

## Summary

Tide Terminal already has a real PTY-backed terminal core, alacritty-based VT
parsing, WGPU rendering, scrollback, search, OSC integrations, mouse reporting,
Kitty keyboard support, and basic terminal graphics. The main product gap is not
that the terminal is fake. The gap is that support is not yet packaged as a
documented, tested, benchmarked terminal product.

## Current Matrix

| Area | Current support | Evidence | Product gap |
| --- | --- | --- | --- |
| PTY and VT parser | Present. Uses `alacritty_terminal` for PTY management and terminal emulation. | [`domain/terminal/mod.rs`](../crates/tide-app/src/domain/terminal/mod.rs), [`domain/terminal.md`](domain/terminal.md) | Expand smoke coverage into external app compatibility checks. |
| Compatibility diagnostics | Present as a headless command and domain test covering search, URLs, OSC 8, ANSI color, OSC title, BEL, OSC 52 write, mouse reporting, wheel forwarding, Kitty keyboard, and TERM/COLORTERM strategy. | [`Compatibility Diagnostics`](compatibility.md), `terminal_product_compatibility_smoke_covers_core_matrix_baseline` in [`tests.rs`](../crates/tide-app/src/domain/terminal/tests.rs) | Add graphics fixtures and real TUI app checks. |
| Rendering architecture | Present. PTY thread, sync thread, and main thread are separated so terminal output does not directly block input/rendering. Headless benchmarks cover parser throughput, grid sync, search, resize, WGPU renderer build, offscreen command submission, and input-to-GPU-complete latency. | [`domain/terminal.md`](domain/terminal.md), [`Benchmarks`](benchmarks.md) | Add visible-window presentation latency, compositor frame pacing, and broader glyph atlas stress coverage. |
| Scrollback | Present with a configurable history. Defaults to 10,000 lines, clamps at the terminal safety maximum, and is exposed in Settings > Terminal. | [`TerminalSettings`](../crates/tide-app/src/domain/state/settings.rs), [`DEFAULT_SCROLLBACK_LINES`](../crates/tide-app/src/domain/terminal/mod.rs), [`Settings`](settings.md) | Document memory tradeoffs and add benchmark coverage for large histories. |
| Search | Present across terminal pane text, with shared in-pane search behavior. | [`specs/search.md`](specs/search.md) | Document terminal search behavior in the user README. |
| MCP terminal observation and find | Present. Wrapped agents can call `tide_observe_terminal` to inspect their caller Terminal's visible screen, cursor, cwd, shell state, scrollback position, selection, URL ranges, and OSC 8 hyperlinks, then `tide_find_in_terminal` to search scrollback and visible output without crossing into sibling Terminals. | [`Tide MCP Runtime`](mcp-runtime.md), [`tide_mcp_runtime.rs`](../crates/tide-app/src/application/behavior_tests/tide_mcp_runtime.rs) | Add product examples showing observe-before-act loops for terminal commands. |
| `TERM` and color env | Present and intentionally conservative. Tide exports `TERM=xterm-256color` and `COLORTERM=truecolor`; a Tide-specific terminfo entry is a future gated decision, not a current claim. | [`domain/terminal/mod.rs`](../crates/tide-app/src/domain/terminal/mod.rs), [`TERM and Terminfo`](terminfo.md) | Add real TUI compatibility checks before broadening terminal identity claims. |
| ANSI and palette colors | Present through the alacritty terminal grid and Tide color conversion. | [`domain/terminal/grid_sync.rs`](../crates/tide-app/src/domain/terminal/grid_sync.rs) | Add visual color regression captures. |
| Keyboard input | Present for text, control, alt-prefix, arrows, navigation keys, function keys, and modifier encodings. | [`key_input.rs`](../crates/tide-app/src/domain/terminal/key_input.rs) | Add a public keyboard protocol table. |
| Kitty keyboard protocol | Present. Applications can opt into Kitty keyboard protocol modes. | [`key_input.rs`](../crates/tide-app/src/domain/terminal/key_input.rs) | Add interoperability tests with real terminal apps that depend on it. |
| Mouse reporting | Present for normal, drag, any-motion, and SGR mouse coordinates. | [`mouse_input.rs`](../crates/tide-app/src/domain/terminal/mouse_input.rs), [`specs/terminal-mouse-reporting.md`](specs/terminal-mouse-reporting.md) | Add user docs for TUI mouse behavior. |
| Wheel forwarding | Present for mouse-reporting apps and alternate-screen alternate-scroll apps. | [`wheel_input.rs`](../crates/tide-app/src/domain/terminal/wheel_input.rs), [`specs/terminal-wheel-forwarding.md`](specs/terminal-wheel-forwarding.md) | Keep parity tests with common TUIs. |
| Plain URL detection | Present for `http` and `https` URL-looking text in visible rows. | [`grid_sync.rs`](../crates/tide-app/src/domain/terminal/grid_sync.rs) | Broaden or document URL matching rules. |
| OSC 8 hyperlinks | Present. Tide preserves hyperlink URI metadata and gives OSC 8 targets priority over URL-looking labels. | [`specs/terminal-osc8-hyperlinks.md`](specs/terminal-osc8-hyperlinks.md) | Add public docs for opening/copying links. |
| OSC 0/2 title | Present. Program-issued title changes are queued and drained by the app. | [`domain/terminal/mod.rs`](../crates/tide-app/src/domain/terminal/mod.rs) | Make title policy visible in Pane chrome docs. |
| BEL | Present as an edge-triggered bell flag. | [`domain/terminal/mod.rs`](../crates/tide-app/src/domain/terminal/mod.rs) | Define audible/visual bell user settings. |
| OSC 9 notifications | Present. OSC 9 payloads feed the same notification path used by wrapped agents. | [`specs/osc-9-notification.md`](specs/osc-9-notification.md) | Add richer acknowledgement history and notification controls. |
| OSC 52 clipboard write | Present. Programs can request clipboard writes. | [`domain/terminal/mod.rs`](../crates/tide-app/src/domain/terminal/mod.rs) | Document security behavior in user-facing copy. |
| OSC 52 clipboard read | Present but gated off by default. `terminal.osc52_read` controls whether reads are allowed and is exposed in Settings > Terminal. | [`domain/state/settings.rs`](../crates/tide-app/src/domain/state/settings.rs), [`Settings`](settings.md) | Add a clearer security explainer before making broader clipboard claims. |
| Terminal graphics | Partial. Kitty image payloads and Sixel payloads are decoded into RGBA placements. | [`graphics.rs`](../crates/tide-app/src/domain/terminal/graphics.rs) | Publish a graphics protocol support table and fixture tests. |
| CWD tracking | Partial. Terminals launch with an explicit cwd and the app has native fallback helpers, but OSC 7-driven `current_dir` is not currently wired as a documented guarantee. | [`domain/terminal/mod.rs`](../crates/tide-app/src/domain/terminal/mod.rs), [`specs/terminal-context.md`](specs/terminal-context.md) | Define the CWD signal contract used by FileTree, Workspace rail, and agent context. |
| Shell integration | Defined for wrapper PATH setup. zsh auto-integration uses `ZDOTDIR`; bash and fish have bundled opt-in snippets through `TIDE_TERMINAL_SHELL_INTEGRATION_DIR`. | [`Shell Integration`](shell-integration.md), [`domain/terminal/mod.rs`](../crates/tide-app/src/domain/terminal/mod.rs), [`resources/shell-integration`](../crates/tide-app/resources/shell-integration) | Add prompt marks and OSC 7 current-directory integration before claiming broader shell semantics. |
| SSH and remote | Defined as a modest local-PTY SSH workflow: run SSH in a Tide Terminal Pane, use standard port forwarding for remote app previews, keep Browser/Editor/Diff/Context Artifact surfaces local, and avoid custom remote terminfo claims. | [`SSH and Remote Workflow`](ssh-remote.md), [`TERM and Terminfo`](terminfo.md) | Add SSH workflow smoke tests with common remote TUIs, then revisit terminfo distribution and remote filesystem support. |
| Session restore | Partial. Layout, cwd, window state, side surfaces, preferences, restore events, and provider-specific explicit agent resume policy are defined. | [`specs/session.md`](specs/session.md), [`Agent Resume Policy`](agent-resume-policy.md) | Decide whether scrollback restore or provider-native resume automation should ever become a claim. |

## Known Non-Claims

Until tested and documented, Tide should not publicly claim:

- Full xterm, iTerm2, Kitty, or WezTerm compatibility.
- Complete Kitty graphics protocol support.
- Complete Sixel protocol support.
- Durable remote sessions.
- Live process checkpoint/restore.
- First-class remote filesystem browsing/editing.
- Remote-host wrapped-agent MCP access to the local Tide app.
- Automatic prompt, command-boundary, and current-directory integration across all shells.
- A Tide-specific terminfo entry.

## Next Proof Work

1. Expand compatibility diagnostics with graphics fixtures and real TUI apps.
2. Add visible-window presentation latency and compositor frame pacing benchmarks.
3. Add real TUI fixtures for the documented `TERM=xterm-256color` strategy.
4. Add SSH workflow smoke tests that cover a forwarded local preview and common
   remote TUI behavior.
5. Add prompt-mark and OSC 7 current-directory shell integration fixtures.
6. Turn this matrix into a README-visible feature table once the smoke checks
   exist.
