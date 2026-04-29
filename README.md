<div align="center">

<img src="assets/icon.png" alt="Tide" width="96" />

# Tide

**A native macOS Workspace where humans and coding agents share Terminal, Editor, Diff, and Browser Panes.**

[![Release](https://img.shields.io/github/v/release/team-attention/tide?style=flat-square&color=blue)](https://github.com/team-attention/tide/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
![Rust](https://img.shields.io/badge/rust-2021-orange?style=flat-square)

</div>

Tide is an Integrated Task Environment for agent-led software work. Run Claude Code, Codex, or Gemini in Terminal Panes, split larger tasks into Workspaces, inspect code and diffs beside the task, and give agents a human-visible Browser Pane for previews, docs, and verification.

Through the Agent Gateway and Tide MCP Runtime, Wrapped Agents can observe the same Workspace structure you see: Pane geometry, Terminal output, Editor content, Browser Pane state, Context Artifacts, and layout targets. Browser work stays inside Tide's Browser Pane Runtime by default, so the human and the agent can look at the same page instead of handing context through screenshots or copy-paste.

https://github.com/user-attachments/assets/c4d04f84-e4fe-4aba-9202-044314f5f3ad

## Features

### Run Multiple Coding Agents

Launch Claude Code, Codex, or Gemini from Terminal Panes. Split agents side by side in the Stage, keep separate tasks in separate Workspaces, and see when each Wrapped Agent is running, idle, or waiting for input.

### Keep Each Task in a Workspace

Each Workspace has its own Pane layout and focus state. Split the Stage, switch to stacked view when you need one focused surface, and move between Workspaces without losing task context.

### Use the Dock as a Terminal Context Surface

Keep the Terminal in the Stage and open its supporting Panes in the Dock: inspect code in an Editor Pane, check a running app in a Browser Pane, compare a Diff Pane, or keep a Render Pane beside the command that produced it. The Dock follows the focused Stage Terminal through the Associated Terminal relationship, so supporting context stays attached to the task that produced it.

### Share a Browser Pane With the Agent

Open a Browser Pane for docs, local previews, and unauthenticated public pages. Agents use `tide_open_browser`, `tide_browser_observe`, and `tide_browser_action` to inspect and operate the existing Browser Pane, with Browser Automation Cursor state visible in the page. External browser runtimes stay explicit fallbacks.

### Capture Context Without Leaving Tide

Create Context Artifacts from Pane selections and comments, then deliver them to the paired agent for the source Pane's Associated Terminal. Agents can explicitly list and read those artifacts through MCP instead of relying on hidden prompt context.

### Render Agent-Generated UI

Agents can create Render Panes with `tide_render_html` for task dashboards, checklists, reports, or custom controls in the same Workspace.

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
┌───────────┬─────────────────────┬──────────┬──────────┐
│ Workspace │        Stage        │   Dock   │ FileTree │
│ rail      │  Terminal Panes     │ Editor   │ View     │
│           │ splits + stacked    │ Browser  │          │
│           │                     │ Diff     │          │
└───────────┴─────────────────────┴──────────┴──────────┘
   Cmd+E        Cmd+H/J/K/L        Cmd+\       Cmd+B
```

- **Workspace rail**: switch between task Workspaces.
- **Stage**: the main area for Terminal Panes, splits, and stacked views.
- **Dock**: the focused Terminal's Terminal Context Surface for Editor, Browser, Diff, Launcher, secondary Terminal, and Render Panes.
- **FileTree View**: the outer-right filesystem view rooted at the focused Terminal's working directory.

## Quick Start

1. Open Tide. It starts with one Workspace and one Terminal Pane.
2. Run a coding agent inside the Terminal, such as Claude Code, Codex, or Gemini.
3. Add another Terminal with `Cmd+T`, split the current FocusArea with `Cmd+Shift+T` or `Cmd+Shift+\`, or open a Browser Pane with `Cmd+Shift+B`.
4. Open or focus the Dock with `Cmd+\`. If the Dock is empty, use the Launcher keys: `B` for a Browser Pane, `E` for a new Editor Pane, `O` to open a file, or `T` for a Terminal Pane.
5. The Dock is tied to the focused Terminal Pane in the Stage. When you move between Terminal Panes, the Dock swaps to that Terminal's workbench.
6. Use `Cmd+B` for FileTree View, `Cmd+E` for the Workspace rail, `Cmd+[` / `Cmd+]` to switch Workspaces, and `Cmd+Shift+N` for a new Workspace.

## Keyboard Shortcuts

All keybindings are customizable in `~/.config/tide/settings.json`. Open settings with `Cmd+,`.

### Workspace

| Shortcut | Action |
| --- | --- |
| `Cmd+[` / `Cmd+]` | Previous / next Workspace |
| `Cmd+Shift+N` | New Workspace |
| `Cmd+Shift+W` | Close Workspace |
| `Cmd+E` | Toggle Workspace rail |

### Panes

| Shortcut | Action |
| --- | --- |
| `Cmd+T` | New Terminal in the Stage, or a Launcher when the Dock is focused |
| `Cmd+Shift+T` | Split the current FocusArea horizontally |
| `Cmd+Shift+\` | Split the current FocusArea vertically |
| `Cmd+\` | Show, hide, or focus the Dock |
| `Cmd+W` | Close focused Pane |
| `Cmd+Enter` | Toggle stacked view for the current FocusArea |
| `Cmd+Ctrl+Enter` | Toggle Dock stacked view |
| `Cmd+Shift+B` | Open a Browser Pane |

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
| `Cmd+H/J/K/L` | Move focus left/down/up/right in the current FocusArea |
| `Cmd+Shift+H/J/K/L` | Navigate the Dock without changing the current FocusArea |
| `Cmd+B` | Toggle FileTree View |
| `Cmd+Shift+O` | Open FileFinder |

### Browser

| Shortcut | Action |
| --- | --- |
| `Cmd+L` | Focus the Browser URL bar |
| `Cmd+R` | Reload |
| `Cmd+Shift+B` | Open new Browser Pane |

### Editor And Utilities

| Shortcut | Action |
| --- | --- |
| `Cmd+S` | Save focused Editor Pane |
| `Cmd+F` | Find in focused Pane |
| `Cmd+C` / `Cmd+V` | Copy / paste |
| `Cmd+U` / `Cmd+D` | Scroll half page up / down |
| `Cmd+=` / `Cmd+-` / `Cmd+0` | Increase / decrease / reset font size |
| `Cmd+Shift+D` | Toggle theme |
| `Cmd+Ctrl+F` | Toggle fullscreen |
| `Cmd+N` | New Tide Window |
| `Cmd+,` | Open settings |

## Why Tide?

Tide is not trying to replace your terminal, editor, browser, or LLM. It is a shared task environment around them.

Terminals are still the substrate. The difference is that the surrounding Workspace is structured: Panes have identity, layout is inspectable, Browser Pane work is visible, context can be captured as Context Artifacts, and agents can use the same surfaces the human is using.

## Roadmap

Tide is moving from a terminal-centered agent app toward a full human-agent Workspace. The near-term product priorities are:

- **Editor Pane maturity**: stronger FileFinder, workspace text search, symbols, diagnostics, completion polish, hover hints, go-to-definition, and go-to-references.
- **Workspace rail hierarchy**: compact task rows with identity, branch/cwd, Wrapped Agent state, change signal, and useful last activity.
- **Browser review loop**: visible Browser Operation state, Browser Pane comments, and Context Artifact delivery to the paired agent.

See [Roadmap](docs/roadmap.md) for the full direction.

## Documentation

- [Vision](docs/vision.md)
- [Roadmap](docs/roadmap.md)
- [System docs](docs/README.md)
- [Domain glossary](docs/glossary.md)
- [Behavior tests guide](docs/testing/behavior-tests.md)

## License

[MIT](LICENSE)
