<div align="center">

<img src="assets/icon.png" alt="Tide" width="96" />

# Tide

### The shared workbench for you and your coding agent.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
[![Release](https://img.shields.io/github/v/release/team-attention/tide?style=flat-square)](https://github.com/team-attention/tide/releases/latest)
[![Stars](https://img.shields.io/github/stars/team-attention/tide?style=social)](https://github.com/team-attention/tide/stargazers)

<!-- HERO: once the demo gif exists, drop it here:
<a href="LINK_TO_DEMO"><img src="assets/hero.gif" alt="Tide, a shared workbench for you and your coding agent" width="820" /></a>
-->

**[⬇ Download for macOS](https://github.com/team-attention/tide/releases/latest)** &nbsp;·&nbsp; **[▶ Watch the demo](LINK_TO_DEMO)**

</div>

---

Let's stop pretending we suddenly love the terminal.

We spent years getting away from it. That's the whole reason IDEs exist. Then a coding agent showed up living in one, and overnight we all decided that narrating into a black box was fine again.

The good news is Codex and Claude seem to have come around, and they're pushing in this exact direction. The thing is, they each come with their own annoyances. Codex won't let you edit a file right there in the editor. Claude's workbench feels like an afterthought. And neither one is open source.

So I built Tide. It's one workbench you and your agent share. It runs the code, opens the browser, clicks through the page, and you're right there with it. Open a file, fix a line, or grab the wheel whenever you want. Works with whatever agent you already use: Claude Code, Codex, Gemini, opencode. It's a local desktop app, MIT-licensed, no account, no cloud.

This is pretty much what working with an agent should feel like.

*(Still insist on the terminal? [Tide Terminal](apps/terminal/) has you covered. No hard feelings.)*

## Install

Download the latest `.dmg` from [Releases](https://github.com/team-attention/tide/releases/latest) and drag it to Applications. Signed and notarized for macOS.

> Tide runs your locally-installed agent CLIs. On first launch it helps you connect the ones you have.

## What's in this repo

Two independent apps, same brand, no shared code:

- **[Tide](apps/desktop/)** — the desktop app above (Electron + Node + React).
- **[Tide Terminal](apps/terminal/)** — the original, terminal-centered version (Rust, native macOS).

Each builds from its own directory.

## License

Copyright © 2025 eatnug. Licensed under the [MIT License](LICENSE).
