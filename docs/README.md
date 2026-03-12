# Tide System Documentation

A DDD-style living specification of the Tide terminal emulator.

## How to Read This

Start with the **glossary** for domain language. Read **specs** for Use Cases and Business Rules. Check **behavior tests** to see those rules verified in code. The traceability chain is:

```
Glossary → Spec (UC + BR) → Behavior Test (BR comment) → Code
```

## Documents

### Foundation
- **[Glossary](glossary.md)** — Ubiquitous language. Every domain term defined in one place.
- **[Context Map](context-map.md)** — How the 8 bounded contexts relate to each other.

### Bounded Contexts (by crate)
- **[Core Types](domain/core-types.md)** — Value Objects and trait contracts shared across all contexts. (`tide-core`)
- **[Layout](domain/layout.md)** — Binary split tree, tab groups, pane arrangement. (`tide-layout`)
- **[Terminal](domain/terminal.md)** — PTY management, grid synchronization, threading. (`tide-terminal`)
- **[Editor](domain/editor.md)** — Text buffer, cursor, syntax highlighting, undo. (`tide-editor`)
- **[Input Routing](domain/input.md)** — Keybinding resolution, hotkey matching, action dispatch. (`tide-input`)
- **[File Tree](domain/file-tree.md)** — Filesystem watching, directory traversal, git status. (`tide-tree`)
- **[Platform](domain/platform.md)** — Native macOS windowing, IME, event sourcing. (`tide-platform`)
- **[Renderer](domain/renderer.md)** — GPU pipeline, glyph atlas, dirty tracking. (`tide-renderer`)

### Application Layer
- **[App Orchestrator](domain/app.md)** — The App aggregate: sub-modules, state management, the update/render loop. (`tide-app`)

### Specs (Use Cases + Business Rules)
- **[Pane Lifecycle](specs/pane-lifecycle.md)** — Create, split, resolve, open, close, drag Panes.
- **[Input Routing](specs/input-routing.md)** — Keystroke resolution, text routing, focus, GlobalAction dispatch.
- **[Modal](specs/modal.md)** — Modal interception, dismiss, lifecycle.
- **[Workspace](specs/workspace.md)** — Switch, close, sidebar, cross-workspace drag.
- **[Terminal Sync](specs/terminal-sync.md)** — PTY → grid sync, render cache invalidation.
- **[Editor](specs/editor.md)** — Text editing, preview mode, scroll.
- **[Launcher](specs/launcher.md)** — Launcher resolution to concrete PaneKind.
- **[Search](specs/search.md)** — In-pane text search and match navigation.
- **[IME](specs/ime.md)** — Input method composition lifecycle and cleanup.
- **[Session](specs/session.md)** — Save/load App state across launches.
- **[Theme](specs/theme.md)** — Theme toggle and font defaults.
- **[File Tree](specs/file-tree.md)** — File tree scroll clamping.

### Living Tests
- **[Behavior Test Guide](testing/behavior-tests.md)** — How to read and write behavioral tests as specification.
