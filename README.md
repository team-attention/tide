<div align="center">

<img src="assets/icon.png" alt="Tide" width="96" />

# Tide

**Local, open-source coding-agent workspaces — two products under one brand.**

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square)](LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)

</div>

Tide is a monorepo with two independent products that share the brand but not code:

| Product | Path | Stack | What it is |
|---------|------|-------|------------|
| **[Tide](apps/desktop/)** | [`apps/desktop/`](apps/desktop/) | Electron + Node + React | A chat-centered, multi-agent Codex App alternative. |
| **[Tide Terminal](apps/terminal/)** | [`apps/terminal/`](apps/terminal/) | Rust + WGPU (native macOS) | The original Tide — a terminal-centered agent Workspace. |

Both run Codex, Claude Code, Gemini, and Antigravity as first-class agents. Each app builds independently from its own directory — **never build from the repo root**. Full details live in each product's README.

---

## Tide  ·  the chat-centered agent app

A free, open-source [Codex App](apps/desktop/) alternative: a focused Agent Chat per Thread, a Composer anchored to that chat, and a Workbench (Browser / Diff / Editor / Terminal Panes) that appears only when the Thread needs it — local, open, and multi-agent.

**Download:** grab the latest `Tide` `.dmg` from [Releases](https://github.com/team-attention/tide/releases/latest) and drag it to Applications. → Details: **[apps/desktop/README.md](apps/desktop/README.md)**

---

## Tide Terminal  ·  the terminal-centered workspace

A native macOS (Rust + WGPU) Workspace where humans and coding agents share Terminal, Editor, Diff, and Browser Panes, driven through the Agent Gateway and Tide MCP Runtime.

**Download:** grab the latest `Tide Terminal` `.dmg` from [Releases](https://github.com/team-attention/tide/releases) and drag it to Applications. → Details: **[apps/terminal/README.md](apps/terminal/README.md)**

---

## License

Copyright © 2025 eatnug. Licensed under [AGPL-3.0](LICENSE).

Contributions are accepted under the [Contributor License Agreement](CLA.md), which lets the owner offer the Project under AGPL-3.0 **and** under separate commercial licenses. For commercial licensing, contact the owner.
