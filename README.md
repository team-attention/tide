<div align="center">

![Tide](assets/icon.png)

# Tide

**A GPU-rendered terminal workspace for macOS**

[![Release](https://img.shields.io/github/v/release/team-attention/tide?style=flat-square&color=blue)](https://github.com/team-attention/tide/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
![Rust](https://img.shields.io/badge/rust-2021-orange?style=flat-square)

</div>

Terminals, files, editor, browser — all in one window. Organize them into workspaces, split them, tab them, zoom into one. Context stays with you however you work.

## Quick Start

Download the latest `.dmg` from [Releases](https://github.com/team-attention/tide/releases), open it, and drag Tide to Applications.

When you open Tide, you start with a single workspace and a terminal ready to go.

The main area (**stage**) is for terminals — split and tab them freely. When you need an editor, browser, or other pane, open it in the **dock** (`Cmd+\`). A **launcher** appears to let you pick what to create:

| Key | What it opens |
|-----|---------------|
| `T` | Terminal |
| `E` | New file (editor) |
| `O` | Open file |
| `B` | Browser |

## Core Concepts

Tide's window is divided into up to four regions:

```
┌───────────┬──────────┬─────────────────────┬──────────┐
│           │          │                     │          │
│ Workspace │  File    │      Stage          │   Dock   │
│ Sidebar   │  Tree    │   (main splits)     │  (pinned │
│           │          │                     │  panes)  │
│           │          │                     │          │
└───────────┴──────────┴─────────────────────┴──────────┘
   Cmd+1       Cmd+2          Cmd+3              Cmd+4
```

- **Workspace Sidebar** — lists all workspaces with name, branch, and working directory. `Cmd+1` toggles it on/off.
- **File Tree** — shows the filesystem rooted at your focused terminal's working directory. `Cmd+2` to focus.
- **Stage** — your main work area, dedicated to terminals. Split and tab them to orchestrate multiple shells side by side (`Cmd+T` for a new tab, `Cmd+Shift+T` to split). `Cmd+3` to focus.
- **Dock** — a side panel for non-terminal panes (editors, browsers, etc.). Open a new pane with `Cmd+\` — a launcher lets you pick the type. Pin a pane with `Cmd+Shift+P` to keep it visible across all terminals in the workspace. `Cmd+4` to focus.

### Workspaces

A workspace is an independent set of panes + layout + focus state. Think of it like a virtual desktop inside Tide.

- `Cmd+[` / `Cmd+]` — switch between workspaces
- `Cmd+Shift+N` — new workspace
- `Cmd+Shift+W` — close workspace

### Pane Types

| Type | Description |
|------|-------------|
| **Terminal** | Full terminal emulator (alacritty backend) |
| **Editor** | Text editor with syntax highlighting and LSP autocompletion |
| **Browser** | Embedded web browser |
| **Diff** | Diff viewer |
| **Launcher** | Quick picker for creating new panes |

## Keybindings

All keybindings are customizable via `~/.config/tide/settings.json`. Open it with `Cmd+,`.

### Stage (terminals)

| Key | Action |
|-----|--------|
| `Cmd+T` | New terminal tab |
| `Cmd+Shift+T` | Split vertically with new terminal |
| `Cmd+W` | Close current tab |

### Dock (editors, browsers, etc.)

| Key | Action |
|-----|--------|
| `Cmd+\` | New pane horizontally (opens launcher) |
| `Cmd+Shift+\` | New pane vertically (opens launcher) |
| `Cmd+Shift+P` | Pin / unpin pane to dock |

### Navigation

| Key | Action |
|-----|--------|
| `Cmd+H/J/K/L` | Move focus across splits (left/down/up/right) |
| `Cmd+Arrow keys` | Move focus across splits (alternative) |
| `Cmd+I` | Previous tab in group |
| `Cmd+O` | Next tab in group |
| `Cmd+1` | Toggle workspace sidebar |
| `Cmd+2/3/4` | Focus file tree / stage / dock |
| `Cmd+Enter` | Zoom — expand focused pane to fill the workspace (toggle) |

### Workspaces

| Key | Action |
|-----|--------|
| `Cmd+[` | Previous workspace |
| `Cmd+]` | Next workspace |
| `Cmd+Shift+N` | New workspace |
| `Cmd+Shift+W` | Close workspace |

### File & Search

| Key | Action |
|-----|--------|
| `Cmd+Shift+O` | File finder |
| `Cmd+F` | Find |

### Window & Display

| Key | Action |
|-----|--------|
| `Cmd+N` | New window |
| `Cmd+Ctrl+F` | Toggle fullscreen |
| `Cmd+Shift+D` | Toggle light/dark theme |
| `Cmd++` / `Cmd+-` | Font size up / down |
| `Cmd+0` | Reset font size |

### Scroll

| Key | Action |
|-----|--------|
| `Cmd+U` | Scroll half page up |
| `Cmd+D` | Scroll half page down |

### Browser (when a browser pane is focused)

| Key | Action |
|-----|--------|
| `Cmd+[` | Back |
| `Cmd+]` | Forward |
| `Cmd+R` | Reload |
| `Cmd+Shift+B` | Open new browser pane |

## Build from Source

```sh
cargo build --release                    # binary
cargo bundle --release -p tide-app       # macOS .app bundle
./scripts/build-dmg.sh                   # signed + notarized DMG
```

## Design Reference

Mockups live in `ui.pen` (Pencil).

Inspiration: [workspace-ui](https://example.com/) — workspace sidebar + splits + session restore.

## License

[MIT](LICENSE)
