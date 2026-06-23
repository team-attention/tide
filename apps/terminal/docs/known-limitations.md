# Known Limitations

Tide Terminal is a real terminal-centered workbench, but it is not claiming to
be a complete terminal emulator, multiplexer, browser, IDE, or remote desktop
replacement. This page keeps the current product boundary explicit.

For positive capability evidence, see [Terminal Capabilities](terminal-capabilities.md),
[Tide MCP Runtime](mcp-runtime.md), and [Compatibility Diagnostics](compatibility.md).

## Terminal Compatibility

Tide uses a PTY-backed terminal core with alacritty-based VT parsing, WGPU
rendering, scrollback, search, mouse reporting, Kitty keyboard support, OSC 8,
OSC 52 write, OSC 9 notification handling, and partial terminal graphics.

Current limitations:

- Tide does not claim full xterm, iTerm2, Kitty, or WezTerm
  compatibility.
- Kitty graphics and Sixel support are partial and need fixture coverage before
  broader public claims.
- Real TUI app compatibility checks still need to expand beyond the current
  headless smoke suite.
- Visible-window presentation latency, compositor frame pacing, and broader
  glyph atlas stress coverage still need repeatable product benchmarks.

## TERM And Remote Hosts

Tide intentionally exports:

```text
TERM=xterm-256color
COLORTERM=truecolor
```

Current limitations:

- Tide does not ship, require, or advertise a Tide-specific terminfo entry.
- Tide does not install terminfo on remote hosts.
- Tide should not claim terminal behaviors that are not implemented,
  documented, and covered by compatibility tests.

See [TERM and Terminfo](terminfo.md) and [SSH and Remote Workflow](ssh-remote.md).

## SSH And Remote Work

SSH runs as an ordinary program inside a Tide Terminal Pane. Tide's current
remote workflow is local-PTY based: run `ssh`, use standard port forwarding for
remote app previews, and keep Browser/Editor/Diff/Context Artifact surfaces
local to the Tide Workspace.

Current limitations:

- No built-in SSH wrapper.
- No automatic remote terminfo install.
- No durable SSH sessions across sleep, network loss, or app restart.
- No remote process checkpoint/restore.
- No remote scrollback restore.
- No first-class remote filesystem browsing or editing.
- No remote-host wrapped-agent MCP bridge back to the local Tide app.

## Shell Integration

Tide's current shell integration contract is limited to wrapped-agent command
resolution. zsh integration is automatic through the bundled `ZDOTDIR` path.
bash and fish have bundled opt-in snippets documented in
[Shell Integration](shell-integration.md).

Current limitations:

- bash and fish startup files are not modified automatically.
- Prompt marks, command timing, and OSC 7 current-directory tracking are not yet
  public guarantees.
- nushell and other shells do not yet have bundled snippets.

## Browser Pane

Tide Browser Pane Runtime is the first browser runtime for wrapped agents inside
Tide. It is intended for local previews, file-backed previews, docs, public
unauthenticated pages, visual verification, page observation, and page comments.

Current limitations:

- Browser Pane is not a full replacement for a regular browser profile.
- Persistent profiles, saved passwords, extensions, passkeys, and full
  credential-manager integration are not current claims.
- In-app download management remains Browser Pane V2 work.
- Screenshot crop, arbitrary region comments, persistent DOM identity, and full
  accessibility-tree parity are future work.
- External browser runtimes remain explicit fallbacks when Tide cannot represent
  the target or the user asks for another browser. Tide records the latest
  fallback in MCP-visible Browser Pane state, but does not claim to control the
  external browser runtime afterward.

## Editor Pane

Editor Pane is useful for task-local reading, selection, search, bounded MCP
replacement, Context Artifact capture, and lightweight editing.

Current limitations:

- Tide does not yet claim full IDE parity.
- Human-facing replace UI and larger refactor workflows are still product gaps.
- Broader code intelligence such as diagnostics, hover, go-to-definition,
  references, rename/refactor actions, and richer symbol indexing are not yet
  part of the public product claim.

## Agent Collaboration

Tide MCP Runtime lets wrapped agents observe Workspace structure, Terminal
output, Browser Panes, Editor Panes, Context Artifacts, and caller-scoped layout
state.

Current limitations:

- MCP tools are local to the Tide app and caller Terminal boundary.
- Context Artifacts are explicit review records, not ambient hidden prompt
  injection.
- Provider-specific resume behavior is defined as explicit relaunch only; Tide
  restores Workspace/cwd context but does not auto-resume provider processes.
- The Workspace attention panel is a compact unread/running summary, not a full
  task inbox with acknowledgement history or filters.
- Provider wrappers are expected to evolve; unsupported future agent CLIs should
  not be assumed to have full Tide MCP parity until integrated.

## Session Restore

Tide persists layout, cwd, window state, side surfaces, and preferences.

Current limitations:

- Live child processes are not checkpointed.
- Scrollback restore is not a current claim.
- Agent process resume is explicit relaunch only for `claude`, `codex`,
  `agy`, and `opencode`; Tide does not invoke provider-native resume
  automatically.
- Context Artifacts are live Workspace state and are not persisted into restart
  session files in V1.

## Packaging And Product Proof

Current limitations:

- Public screenshots and video proof still need to replace remaining demo
  placeholders.
- Install, update-feed, signing, notarization, and source-build expectations are
  documented in [Install, Update, Signing, And Source Build](install-release.md)
  and should stay current as the product matures.
- Performance and compatibility claims should stay tied to checked-in diagnostics
  and benchmarks.

## How To Read These Limits

These limits are not a retreat from the product direction. They are the guardrail
that lets Tide make stronger claims over time. A limitation should be removed
only when there is a clear product behavior, documentation, and a repeatable
test or diagnostic that proves the claim.
