# Tide Documentation

Product direction and DDD-style living specifications for Tide.

## How to Read This

Start with the **glossary** for domain language. Read **specs** for Use Cases and Business Rules. Check **behavior tests** to see those rules verified in code. The traceability chain is:

```
Glossary → Spec (UC + BR) → Behavior Test (BR comment) → Code
```

## Documents

### Product
- **[Vision](vision.md)** — The Integrated Task Environment direction for human-agent work.
- **[Product Standard](product-standard.md)** — The terminal-grade collaborative workbench bar for public confidence.
- **[Roadmap](roadmap.md)** — Public product roadmap across Terminal, Editor, Browser, Workspace rail, review, and local actions.
- **[Known Limitations](known-limitations.md)** — Current non-claims and product boundaries stated plainly.
- **[Install And Release](install-release.md)** — Install path, update feed, signing/notarization, and source-build expectations.
- **[Terminal Capabilities](terminal-capabilities.md)** — Current terminal feature matrix, support evidence, and product gaps.
- **[Compatibility Diagnostics](compatibility.md)** — Headless terminal compatibility command and covered fixtures.
- **[Benchmarks](benchmarks.md)** — Headless terminal-core, WGPU render, and input-latency benchmark commands and metrics.
- **[Tide MCP Runtime](mcp-runtime.md)** — Provider-neutral workbench contract for wrapped agents.
- **[Agent Tool Guidance](agent-tool-guidance.md)** — Real MCP tool-use flows for Terminal, Browser, Editor, and Context Artifact work.
- **[Agent Resume Policy](agent-resume-policy.md)** — Provider-by-provider restart and resume boundaries for Wrapped Agents.
- **[Project Local Configuration](project-config.md)** — `.tide/workspace.json` Workspace presets and Action recipes exposed through the workbench.
- **[Settings](settings.md)** — Settings modal sections, terminal settings, JSON keys, and current gaps.
- **[Shell Integration](shell-integration.md)** — zsh auto-integration plus bash/fish wrapper-path snippets.
- **[TERM and Terminfo](terminfo.md)** — Conservative `TERM=xterm-256color` strategy and future custom-terminfo gate.
- **[SSH and Remote Workflow](ssh-remote.md)** — Current SSH baseline, remote app loop, local workbench boundaries, and non-claims.
- **[Keybindings](keybindings.md)** — Default shortcuts, settings JSON format, and accepted action keys.

### Foundation
- **[Glossary](glossary.md)** — Ubiquitous language. Every domain term defined in one place.
- **[Context Map](context-map.md)** — How the bounded contexts relate within the monocrate.

### Bounded Contexts (by module)
- **[Core Types](domain/core-types.md)** — Value Objects and trait contracts shared across all contexts. (`domain/core_types.rs`)
- **[Layout](domain/layout.md)** — Binary split tree, tab groups, pane arrangement. (`domain/layout/`)
- **[Terminal](domain/terminal.md)** — PTY management, grid synchronization, threading. (`domain/terminal/`)
- **[Editor](domain/editor.md)** — Text buffer, cursor, syntax highlighting, undo. (`domain/editor/`)
- **[Input Routing](domain/input.md)** — Keybinding resolution, hotkey matching, action dispatch. (`domain/input/`)
- **[File Tree](domain/file-tree.md)** — Filesystem watching, directory traversal, git status. (`domain/tree/`)
- **[Platform](domain/platform.md)** — Native macOS windowing, IME, event sourcing. (`adapter/outward/platform_adapter/`)
- **[Renderer](domain/renderer.md)** — GPU pipeline, glyph atlas, dirty tracking. (`adapter/outward/renderer_adapter/`)

### Application Layer
- **[App Orchestrator](domain/app.md)** — The App aggregate: sub-modules, state management, the update/render loop. (`app.rs`)

### Specs (Use Cases + Business Rules)
- **[Pane Lifecycle](specs/pane-lifecycle.md)** — Create, split, resolve, open, close, drag Panes.
- **[Input Routing](specs/input-routing.md)** — Keystroke resolution, text routing, focus, GlobalAction dispatch.
- **[Modal](specs/modal.md)** — Modal interception, dismiss, lifecycle.
- **[Workspace](specs/workspace.md)** — Switch, close, Workspace rail, cross-workspace drag.
- **[Terminal Sync](specs/terminal-sync.md)** — PTY → grid sync, render cache invalidation.
- **[Editor](specs/editor.md)** — Text editing, preview mode, scroll.
- **[Launcher](specs/launcher.md)** — Launcher resolution to concrete PaneKind.
- **[Search](specs/search.md)** — In-pane text search and match navigation.
- **[IME](specs/ime.md)** — Input method composition lifecycle and cleanup.
- **[Session](specs/session.md)** — Save/load App state across launches.
- **[Theme](specs/theme.md)** — Theme mode, built-in palettes, and font defaults.
- **[Product Surface](specs/product-surface.md)** — First-run guide for Tide's terminal-first workbench model.
- **[FileTree View](specs/file-tree.md)** — FileTree View placement and scroll clamping.

### Living Tests
- **[Behavior Test Guide](testing/behavior-tests.md)** — How to read and write behavioral tests as specification.
