<div align="center">

<img src="assets/icon.png" alt="Tide" width="96" />

# Tide

**A native macOS workspace for coding agents, Terminal Panes, files, and Browser Panes.**

[![Release](https://img.shields.io/github/v/release/team-attention/tide?style=flat-square&color=blue)](https://github.com/team-attention/tide/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
![Rust](https://img.shields.io/badge/rust-2021-orange?style=flat-square)

</div>

Tide changes the coding-agent workflow: run Claude Code, Codex, or Gemini side by side in Terminal Panes, separate larger tasks into Workspaces, inspect files in the FileTree, and keep each Terminal's supporting Editor, Browser, Diff, and Render Panes in the Dock. Through the Agent Gateway, agents can work with the same Workspace context you are looking at.

https://github.com/user-attachments/assets/c4d04f84-e4fe-4aba-9202-044314f5f3ad

## Features

### Run multiple coding agents at once

Launch Claude Code, Codex, or Gemini from Terminal Panes. Split agents side by side in the Stage, keep separate tasks in separate Workspaces, and see when each Wrapped Agent is running, idle, or waiting for input.

### Workspaces, splits, and tabs

Each Workspace has its own Pane layout and focus state. Split the Stage, stack Panes in TabGroups, move between Workspaces, and zoom into the focused Pane when you need more room.

### Dock as a per-Terminal workbench

Keep the Terminal in the Stage and open its supporting Panes in the Dock: inspect code in an Editor Pane, check a running app in a Browser Pane, compare a Diff Pane, or keep a Render Pane beside the command that produced it. Dock Panes follow their Associated Terminal, while pinned Panes stay visible across terminals in the Workspace.

### Browser and render Panes

Open a Browser Pane for docs, previews, and local apps. Agents can also create Render Panes with `tide_render_html` for task dashboards, checklists, or custom UI in the same Workspace.

### Shared context for agents

Every Pane is observable through the Agent Gateway and MCP bridge. Agents can list Panes, capture Terminal or Editor content, open files, send keys, open browser URLs, render UI, and inspect layout.

## Install

### DMG

Download the latest `.dmg` from [Releases](https://github.com/team-attention/tide/releases), open it, and drag Tide to Applications.

### From source

```sh
cargo build --release                    # binary
./scripts/build-app.sh                   # macOS .app bundle + Info.plist fixup + ad-hoc sign
./scripts/build-dmg.sh                   # signed + notarized DMG
```

## How Tide Is Organized

```text
┌───────────┬──────────┬─────────────────────┬──────────┐
│ Workspace │ FileTree │        Stage        │   Dock   │
│ Sidebar   │          │  Terminal Panes     │ Editor   │
│           │          │  splits + tabs      │ Browser  │
│           │          │                     │ Diff     │
└───────────┴──────────┴─────────────────────┴──────────┘
   Cmd+1       Cmd+2          Cmd+3              Cmd+4
```

- **Workspace Sidebar**: switch between task Workspaces.
- **FileTree**: browse files rooted at the focused Terminal's working directory.
- **Stage**: the main area for Terminal Panes, splits, and TabGroups.
- **Dock**: the focused Terminal's workbench for code, Browser, Diff, and agent-generated UI Panes.

## Quick Start

1. Open Tide. It starts with one Workspace and one Terminal Pane.
2. Run a coding agent inside the Terminal, such as Claude Code, Codex, or Gemini.
3. Split the Stage with `Cmd+\` or add a Terminal tab with `Cmd+T`.
4. Create a Dock Launcher with `Cmd+Ctrl+\`, then press `B` for a Browser Pane, `E` for a new Editor Pane, or `O` to open a file.
5. The Dock is tied to the focused Terminal Pane in the Stage. When you move between Terminal Panes, the Dock swaps to that Terminal's workbench.
6. Use `Cmd+2` for the FileTree, `Cmd+1` for the Workspace Sidebar, `Cmd+[` / `Cmd+]` to switch Workspaces, and `Cmd+Shift+N` for a new Workspace.

## Keyboard Shortcuts

All keybindings are customizable in `~/.config/tide/settings.json`. Open settings with `Cmd+,`.

### Workspace

| Shortcut | Action |
| --- | --- |
| `Cmd+[` / `Cmd+]` | Previous / next Workspace |
| `Cmd+Shift+N` | New Workspace |
| `Cmd+Shift+W` | Close Workspace |
| `Cmd+1` | Toggle Workspace Sidebar |

### Panes

| Shortcut | Action |
| --- | --- |
| `Cmd+T` | New Terminal tab |
| `Cmd+\` | Split the current area horizontally |
| `Cmd+Shift+\` | Split the current area vertically |
| `Cmd+Ctrl+\` | Split the Dock with a Launcher |
| `Cmd+Ctrl+T` | New Launcher tab in the Dock |
| `Cmd+W` | Close focused Pane |
| `Cmd+Enter` | Toggle stacked view |

### Launcher

| Key | Action |
| --- | --- |
| `B` | Browser Pane |
| `E` | New Editor Pane |
| `O` | Open file |
| `T` | Terminal Pane |

### Navigation

| Shortcut | Action |
| --- | --- |
| `Cmd+H/J/K/L` | Move focus left/down/up/right |
| `Cmd+I` / `Cmd+O` | Previous / next tab in a TabGroup |
| `Cmd+2` / `Cmd+3` / `Cmd+4` | Focus FileTree / Stage / Dock |

### Browser

| Shortcut | Action |
| --- | --- |
| `Cmd+[` / `Cmd+]` | Back / forward |
| `Cmd+R` | Reload |
| `Cmd+Shift+B` | Open new Browser Pane |

## Why Tide?

Tide is not trying to replace your terminal, editor, browser, or LLM. It is a shared task environment around them.

Terminals are still the substrate. The difference is that the surrounding Workspace is structured: Panes have identity, layout is inspectable, context can be captured, and agents can use the same surfaces the human is using.

## Documentation

- [Vision](docs/vision.md)
- [System docs](docs/README.md)
- [Domain glossary](docs/glossary.md)
- [Behavior tests guide](docs/testing/behavior-tests.md)

## License

[MIT](LICENSE)
