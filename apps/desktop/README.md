<div align="center">

<img src="../../assets/icon.png" alt="Tide" width="96" />

# Tide

**The shared workbench for you and your coding agent. Local, open-source, bring your own agent.**

[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](../../LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
![Electron](https://img.shields.io/badge/electron-node%20%2B%20react-47848F?style=flat-square)

</div>

Tide is a desktop app (Electron + Node + React) that puts you and your coding agent in one shared workbench. Each Thread has a focused Agent Chat with its Composer anchored to it, plus a Workbench (Browser, Diff, Editor, and Terminal Panes with a FileTree) that you and the agent both read and operate. It runs your locally-installed agent CLIs, so you bring your own and switch per task.

- **Claude Code, Codex, Gemini, and opencode** are first-class agents.
- Any Thread can be powered by any supported agent.
- Local and account-free. Tide drives the CLIs already on your machine.

When split vertically, the mental model is:

```text
Left UI | Agent Chat | Workbench
```

- **Left UI**: work history — your Threads.
- **Agent Chat**: one focused AI Agent chat for the selected Thread, with its Composer anchored at the bottom of the chat.
- **Workbench**: the optional visible work area inside the active Thread — Browser, Diff, Editor, or Terminal Panes, plus FileTree and context-artifact views for inspection, editing, verification, and direct work.

> Looking for the native macOS terminal workspace? See **[Tide Terminal](../terminal/)** (`apps/terminal/`).

## Install

Download the latest Tide `.dmg` from [Releases](https://github.com/team-attention/tide/releases/latest), then drag it to Applications.

> Building from source / contributing: see [`docs_v2/`](docs_v2/).

## Documentation

- [Master Plan](docs_v2/master-plan.md)
- [Glossary](docs_v2/glossary.md)
- [Specs](docs_v2/specs/README.md)
- [Architecture decisions](docs_v2/implementation/electron-node-architecture-decisions.md)

## License

[MIT](../../LICENSE).
