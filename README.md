<div align="center">

<img src="assets/icon.png" alt="Tide" width="96" />

# Tide

### The shared workbench for you and your coding agent.

**See what your agent sees. Open the code, edit it, comment on it, right alongside it.**
<br/>Works with **opencode, Claude Code, Codex, and Gemini**. Local and open-source.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
[![Release](https://img.shields.io/github/v/release/team-attention/tide?style=flat-square)](https://github.com/team-attention/tide/releases/latest)
[![Stars](https://img.shields.io/github/stars/team-attention/tide?style=social)](https://github.com/team-attention/tide/stargazers)

**[⬇ Download for macOS](https://github.com/team-attention/tide/releases/latest)** &nbsp;·&nbsp; **[▶ Watch the demo](https://github.com/user-attachments/assets/c4d04f84-e4fe-4aba-9202-044314f5f3ad)**

</div>

https://github.com/user-attachments/assets/c4d04f84-e4fe-4aba-9202-044314f5f3ad

---

## The idea

Let's stop pretending working in terminals is fun.

AI agents changed how we build software, but the interface somehow moved
backward.

We're watching logs scroll, juggling chats, terminals, diffs, browsers, and
files, trying to coordinate work that should be happening in one place.

Tide is an open-source Codex alternative built around a simple idea:

**Don't just chat with AI. Work with agents on a shared workbench.**

It supports **Codex, Claude Code, Gemini, and opencode**.

Free, open source, and built for how agentic work should actually feel.

*(Prefer a terminal-first workflow? [Tide Terminal](apps/terminal/) keeps the live terminal at the center and wraps it with the same shared workbench model.)*

## Why Tide

- 🤝 **One shared workbench.** Browser, Diff, Editor, and Terminal panes that you and the agent both read and operate.
- ✍️ **You work too.** Open files, edit them, leave comments, steer mid-task. The agent is not the only one with hands.
- 👁 **Watch the browser, take the wheel.** See the agent click through a page, and grab control whenever you want.
- 🔀 **Bring your own agent.** opencode, Claude Code, Codex, Gemini. Same workbench, switch per task.
- 🔒 **Local and account-free.** MIT-licensed. No Tide account, no Tide cloud. Tide drives the agent CLIs you already use.

## Install

Download the latest `.dmg` from [Releases](https://github.com/team-attention/tide/releases/latest) and drag it to Applications. Signed and notarized for macOS.

> Tide runs your locally-installed agent CLIs. On first launch it helps you connect the ones you have.

---

## Two products, one brand

Tide is a monorepo with two independent products that share the brand but not code:

| Product | Path | Stack | What it is |
|---------|------|-------|------------|
| **[Tide](apps/desktop/)** | [`apps/desktop/`](apps/desktop/) | Electron + Node + React | The shared-workbench desktop app above. |
| **[Tide Terminal](apps/terminal/)** | [`apps/terminal/`](apps/terminal/) | Rust + WGPU (native macOS) | The original Tide, a terminal-centered agent workspace. |

Each app builds independently from its own directory. **Never build from the repo root.** Full details live in each product's README.

## License

Copyright © 2025 eatnug. Licensed under the [MIT License](LICENSE).
