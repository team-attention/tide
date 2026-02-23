<div align="center">

![Tide](assets/icon.png)

# Tide

**A GPU-rendered terminal workspace for macOS**

[![Release](https://img.shields.io/github/v/release/eatnug/tide?style=flat-square&color=blue)](https://github.com/eatnug/tide/releases)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
![Rust](https://img.shields.io/badge/rust-2021-orange?style=flat-square)

</div>

Everything you need stays in one window. Terminals, files, editor, browser — split them, stack them, zoom into one. Context stays with you however you work.

## Features

- **Split panes** — tile terminals side by side, drag to resize
- **File tree** — always in sync with what you're working on
- **Editor dock** — code, diffs, browser, markdown preview alongside your terminal
- **Stacked mode** — collapse into tabs for focused single-pane work
- **Session restore** — pick up exactly where you left off
- **GPU rendering** — powered by wgpu for smooth, low-latency output

## Keybindings

Customizable via `~/.config/tide/settings.json`.

| Key | Action |
|---|---|
| `Cmd+1` / `2` / `3` | Toggle file tree / pane area / editor dock |
| `Cmd+H/J/K/L` | Navigate within area |
| `Cmd+Enter` | Toggle fullscreen zoom |
| `Cmd+T` | New split (horizontal) |
| `Cmd+Shift+T` | New split (vertical) |
| `Cmd+W` | Close pane |
| `Cmd+I` / `Cmd+O` | Dock tab prev / next |
| `Cmd+Shift+O` | File finder |
| `Cmd+F` | Search |

## Install

Download the latest `.dmg` from [Releases](https://github.com/eatnug/tide/releases).

## Build from Source

```sh
cargo build --release                    # binary
cargo bundle --release -p tide-app       # macOS .app bundle
./scripts/build-dmg.sh                   # signed + notarized DMG
```

## Roadmap

**Phase 1 — Polish the Core**
Passkey support in browser panel, editor improvements (find & replace, multi-cursor), better terminal search UX, clipboard image support.

**Phase 2 — Document Panel**
A first-class document pane for writing and organizing markdown alongside terminals and code. Internal linking, full-text search, inline images.

**Phase 3 — Extensibility**
Plugin system, custom widgets/blocks, CLI tool to control Tide from the terminal, theming API.

**Phase 4 — Cross-Platform**
Linux (Wayland + X11) and Windows support.

### Non-Goals

- **Full IDE** — no LSP, debugger, or project-level refactoring. Tide is a workspace, not an IDE.
- **App Store distribution** — direct DMG distribution only.

## Architecture

```
tide-app          Application entry, event loop, rendering
tide-platform     Native macOS platform layer (NSApplication/NSWindow/NSView)
tide-renderer     wgpu-based GPU renderer
tide-terminal     Terminal emulation (alacritty_terminal backend)
tide-editor       Built-in editor
tide-layout       Pane layout engine
tide-tree         File tree
tide-input        Keybinding & input handling
tide-core         Shared types and utilities
```

## License

[MIT](LICENSE)
