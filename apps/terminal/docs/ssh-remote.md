# SSH and Remote Workflow

Tide Terminal's current remote story is intentionally modest: SSH runs inside a
normal Tide Terminal Pane, while Tide's workbench surfaces remain local and
visible. This gives users a clear, compatible baseline without claiming durable
remote sessions or a custom remote protocol before those features exist.

## Current Contract

- `ssh`, `mosh`, remote shells, containers, and tmux run as ordinary programs in
  a Tide Terminal Pane.
- Tide exports `TERM=xterm-256color` and `COLORTERM=truecolor` to local PTY
  children.
- Tide does not require a Tide-specific terminfo entry on the remote host.
- Tide does not install terminfo over SSH.
- Tide does not currently claim durable SSH sessions, remote process restore, or
  live scrollback restore after reconnect.
- Tide workbench surfaces are local: Browser Pane, Editor Pane, Diff Pane,
  Render Pane, FileTree View, and Context Artifacts belong to the local Tide
  Workspace.

## Recommended Remote App Loop

For a remote development server, use standard SSH port forwarding and keep the
review surface in Tide:

```bash
ssh -L 5173:localhost:5173 user@example.com
```

Run the remote app inside the SSH session, then open the forwarded URL in a Tide
Browser Pane:

```text
http://localhost:5173
```

The Browser Pane is local and visible. A wrapped agent can use
`tide_open_browser`, `tide_browser_observe`, `tide_browser_action`, screenshot
content, BrowserSnapshot search, and Context Artifacts against that local
Browser Pane while the server itself runs remotely.

## Wrapped Agents And MCP

Tide MCP Runtime is scoped to the local Tide app and the local Terminal Pane
that launched the wrapped agent.

Recommended pattern:

1. Run wrapped agents locally inside Tide when they need Tide MCP tools.
2. Let those agents drive remote commands through the visible SSH session when
   the task is remote.
3. Use local Browser Panes for forwarded previews and docs.
4. Use Context Artifacts for human comments on remote Terminal output or local
   Browser/Diff/Editor review surfaces.

Do not assume a coding agent launched on the remote host can talk back to the
local Tide MCP Runtime. Remote MCP bridging is future work, not a current Tide
claim.

## Files And Diffs

Tide's FileTree View, Editor Pane, and Diff Pane currently operate on local
filesystem state. For remote projects, use one of these patterns:

- Keep a local checkout and use SSH only for remote command execution.
- Use git branches or patches to move changes between local and remote hosts.
- Mount a remote filesystem externally, then treat the mount as a local path.

Until Tide has a first-class remote filesystem model, the Workspace boundary is
local. A remote shell can still be part of the task, but remote files are not
automatically Tide Editor/Diff surfaces.

## TERM And Terminfo

Tide uses the conservative identity documented in
[TERM and Terminfo](terminfo.md):

```text
TERM=xterm-256color
COLORTERM=truecolor
```

This avoids the common failure mode where a custom `TERM` value reaches a remote
host that does not have the matching terminfo entry installed. Tide can revisit
a custom terminfo entry after compatibility coverage, install/update, and remote
distribution are strong enough to make it reliable.

## Clipboard, Links, And Browser Hand-Off

- OSC 52 clipboard writes are supported by Tide's terminal core, subject to Tide
  settings and security policy.
- OSC 52 clipboard reads are gated off by default.
- OSC 8 hyperlinks and plain URL detection work in local Terminal rendering.
- Browser work should prefer Tide Browser Pane Runtime for visible review.
- External browser runtimes are explicit fallbacks when profile, credential,
  popup, or site behavior exceeds Tide Browser Pane's current claims.

## Non-Claims

Tide should not publicly claim these yet:

- Built-in SSH wrapper behavior like automatic remote terminfo install.
- Durable SSH sessions across sleep, network loss, or app restart.
- Remote process checkpoint/restore.
- Remote scrollback restore.
- First-class remote filesystem browsing/editing.
- Remote-host wrapped-agent MCP access to the local Tide app.
- A Tide-specific `TERM` value.

## Future Work

Remote work can become more ambitious after the local terminal/workbench bar is
solid:

1. SSH workflow smoke tests with common remote TUIs.
2. Optional SSH helper that can install or verify terminfo.
3. A remote filesystem story for FileTree, Editor, and Diff Panes.
4. Provider-aware agent resume over SSH where the provider supports it.
5. Durable session tracking and reconnect UX.
6. A carefully scoped remote MCP bridge, if it can preserve Tide's local
   Workspace ownership and consent model.
