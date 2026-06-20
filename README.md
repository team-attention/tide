<div align="center">

<img src="assets/icon.png" alt="Tide" width="96" />

# Tide

### Open-source Codex app alternative.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
[![Release](https://img.shields.io/github/v/release/team-attention/tide?style=flat-square)](https://github.com/team-attention/tide/releases/latest)
[![Stars](https://img.shields.io/github/stars/team-attention/tide?style=social)](https://github.com/team-attention/tide/stargazers)

**[⬇ Download for macOS](https://github.com/team-attention/tide/releases/latest)** &nbsp;·&nbsp; **[▶ Watch the demo](https://github.com/user-attachments/assets/c4d04f84-e4fe-4aba-9202-044314f5f3ad)**

</div>

https://github.com/user-attachments/assets/c4d04f84-e4fe-4aba-9202-044314f5f3ad

---

Let's stop pretending working in terminals is fun.

AI agents changed how we build software, but the interface somehow moved
backward.

We're watching logs scroll, juggling chats, terminals, diffs, browsers, and
files, trying to coordinate work that should be happening in one place.

Tide is a free, open-source Codex app alternative.

**Don't just chat with AI.**<br/>
**Work with agents on a shared workbench.**

It supports **Codex, Claude Code, Gemini, and opencode**.

Download Tide. Star the repo.

## Install

Download the latest `.dmg` from [Releases](https://github.com/team-attention/tide/releases/latest) and drag it to Applications. Signed and notarized for macOS.

> Tide runs your locally-installed agent CLIs. On first launch it helps you connect the ones you have.

---

## Products

This monorepo contains two apps:

| Product | Path | Stack | What it is |
|---------|------|-------|------------|
| **[Tide](apps/desktop/)** | [`apps/desktop/`](apps/desktop/) | Electron + Node + React | Desktop shared workbench for AI agents. |
| **[Tide Terminal](apps/terminal/)** | [`apps/terminal/`](apps/terminal/) | Rust + WGPU (native macOS) | Native terminal-centered agent workspace. |

Each app builds independently from its own directory. **Never build from the repo root.** Full details live in each product's README.

## License

Copyright © 2025 eatnug. Licensed under the [MIT License](LICENSE).
