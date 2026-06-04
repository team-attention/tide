<div align="center">

<img src="../../assets/icon.png" alt="Tide" width="96" />

# Tide

**A free, open-source Codex App alternative for local coding-agent work — with multi-agent support.**

[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../../LICENSE)
![Platform](https://img.shields.io/badge/platform-macOS-lightgrey?style=flat-square)
![Electron](https://img.shields.io/badge/electron-node%20%2B%20react-47848F?style=flat-square)

</div>

Tide is a chat-centered desktop app (Electron + Node + React) for running coding agents locally. It follows the Codex App experience — a focused Agent Chat per Thread, a Composer anchored to that chat, and a Workbench that appears only when the active Thread needs it — but it is **local, open, and multi-agent**.

- **Codex CLI, Claude Code, and Antigravity CLI** are first-class Provider CLI Agents.
- **OpenAI API** is available as an API-backed Tide Agent when direct API runtime support is enabled.
- Any Thread can be powered by any supported Agent.

When split vertically, the mental model is:

```text
Left UI | Agent Chat | Workbench
```

- **Left UI**: work history — your Threads.
- **Agent Chat**: one focused AI Agent chat for the selected Thread, with its Composer anchored at the bottom of the chat.
- **Workbench**: the optional visible work area inside the active Thread — Browser, Diff, Editor, or Terminal Panes, plus FileTree and context-artifact views for inspection, editing, verification, and direct work.

> Looking for the native macOS terminal workspace? See **[Tide Terminal](../terminal/)** (`apps/terminal/`).

## Install

> Packaged downloads are **coming soon**. For now, run from source.

### From source

Build and run from this directory (never from the repo root):

```sh
cd apps/desktop
npm install
npm start              # build + launch
npm run dev            # HMR dev
npm run package:mac    # macOS .dmg (dist/package-mac/)
```

## Develop

```sh
cd apps/desktop
npm test               # behavior tests
npm run typecheck      # TypeScript
npm run test:architecture
npm run test:smoke:electron
```

## Documentation

- [Master Plan](docs_v2/master-plan.md)
- [Glossary](docs_v2/glossary.md)
- [Specs](docs_v2/specs/README.md)
- [Architecture decisions](docs_v2/implementation/electron-node-architecture-decisions.md)

## License

[MIT](../../LICENSE)
