# Tide - Codex Repository Instructions

This `AGENTS.md` applies to the entire repository and serves as the repo-level instruction file for Codex.

Repo-wide engineering rules live here. Tool-specific workflow wrappers stay in `.claude/commands/spets.md` and `.codex/skills/spets/SKILL.md`.

## Evidence-First (Blocking)

Every factual claim in a message MUST be backed by evidence gathered in the current conversation.
Evidence means: code you read, search results you got, docs you checked, or something the user told you.
If you have no evidence, gather it before responding or explicitly ask the user.

This is a blocking rule. Do not write a factual claim first and plan to verify it afterward. Verify first, respond second.

How to apply:
1. Before describing how something works, read the relevant code first.
2. Before claiming something exists or does not exist, search for it first.
3. Before proposing an approach, understand the current system by reading code first.
4. If no evidence can be found, say "I do not know" and ask the user.

Violations include:
- Describing architecture, threading model, data flow, or patterns without reading the code.
- Claiming a feature exists or does not exist without searching.
- Proposing technical tradeoffs based on assumptions about the codebase.
- Saying "currently X works like Y" without having read X.

This applies to everything: how code works, what a function does, whether something is used, side effects of a change, external library APIs and their behavior, and similar claims.

## Domain Language (Required)

All code, commits, PRs, and discussions MUST use the terms defined in `docs/glossary.md`.
Before writing code or describing changes, check the glossary. If a term does not exist, add it.

Key terms to always use precisely:
- Pane (not "panel", "tab", "window") - a content container with a PaneId
- PaneKind - the 5 types: Terminal, Editor, Diff, Browser, Launcher
- Workspace - an isolated set of panes + layout + focus (not "tab group", "session")
- TabGroup - multiple panes stacked in one layout slot (not "workspace")
- FocusArea - FileTree, Stage, or Dock (not "focus mode", "focus zone")
- SplitLayout - the binary tree of splits (not "grid", "tiling")
- ModalStack - mutually-exclusive popups (not "dialog", "overlay")
- GlobalAction - a user-intent command from keybinding (not "event", "message")
- Generation - monotonic counter for cache invalidation (not "version", "revision")

## Bounded Contexts (Modules)

All code lives in tide-app (monocrate). Each module is a bounded context:

| Module | Path | Responsibility | Key Entities |
|--------|------|---------------|--------------|
| core_types | `domain/core_types.rs` | Shared types and traits | PaneId, Rect, Key, TerminalGrid |
| layout | `domain/layout/` | Binary split tree | SplitLayout, TabGroup |
| terminal | `domain/terminal/` | PTY and grid sync | Terminal |
| editor | `domain/editor/` | Text buffer and cursor | EditorState |
| input | `domain/input/` | Keybinding resolution | Router, Hotkey, GlobalAction |
| tree | `domain/tree/` | Filesystem and git status | FsTree |
| platform | `adapter/outward/platform_native/` | Native macOS windowing | PlatformEvent, PlatformWindow |
| renderer | `adapter/outward/renderer/` | GPU rendering pipeline | WgpuRenderer, GlyphAtlas |
| lsp | `adapter/outward/lsp_client/` | Language server protocol | LspClient, LspManager |

Aliases in `main.rs`: `pub(crate) use domain::terminal as tide_terminal;` and similar `crate::tide_X::` paths work everywhere.

## Feature Development (MUST)

When adding a new feature or fixing a bug, follow this order. Do not skip steps or reverse the order.

```text
1. Spec -> Understand the system -> Clarify requirements with user -> Write spec
2. Test -> Write behavior tests for each Business Rule (crates/tide-app/src/behavior_tests.rs)
3. Code -> Write code that passes the tests
```

- Never skip or reverse this order, even when told "just do it all" or "do not ask questions". Those instructions mean work autonomously, not skip the process.
- No code without a spec, and no implementation without tests.
- The same rule applies when modifying existing specs: spec change -> test change -> code change.
- When a new requirement is discovered mid-implementation, stop coding and loop back: update spec -> add test -> then code.
- Use domain terms from `docs/glossary.md` when writing specs. Add new terms to the glossary first if needed.

### Spec Format (`docs/specs/{feature}.md`)

```markdown
# Spec: {Name}

## Overview
### As-Is
### To-Be
### Approach
## Bounded Contexts
## Use Cases
## Invariants
## Tests
## Location
```

More specifically:
- As-Is: current state and problems, grounded in code.
- To-Be: target state after the change.
- Approach: step-by-step plan.
- Use Cases: actor, trigger, precondition, flow, postcondition, business rules.
- Tests: UC to BR to test function mapping table.
- Location: code location.

### Test Conventions

- Test module comment: `// Spec: docs/specs/{feature}.md`
- UC section comment: `// --- UC-N: {Name} ---`
- Each test references its BR: `// UC-N BR-M: {rule description}`
- Test name is a natural language sentence: `fn closing_last_pane_in_workspace_shows_launcher()`

### Naming Rule

- Glossary term = code type name, and they must match.
- Spec use case name = test section comment, and they must match.
- Business Rule number = referenced in the test function comment.

See `docs/testing/behavior-tests.md` for the full guide.

## Commit Messages

Format: `<verb> <what> in <module>`

```text
Add pane drag preview in tide-app
Fix TabGroup active index after layout
Extract GridSyncer dirty tracking in terminal
```

- Verb: Add (new feature), Fix (bug), Extract (refactor), Remove, Update.
- What: use domain terms from the glossary.
- Module: the bounded context module primarily affected.

## PR Description

Follow the template in `.github/PULL_REQUEST_TEMPLATE.md`. It must include:
- Which spec and use case are affected, for example `pane-lifecycle UC-5: ClosePane`
- Which bounded context is touched
- Which entity or aggregate is modified
- Which invariants are preserved or changed
- Which behavior tests were added, including BR references

## Architecture Invariants

These must never be violated:

1. PaneId sync: every PaneId in SplitLayout MUST exist in `App.panes` HashMap, and vice versa.
2. Single active workspace: only the active Workspace is loaded into App fields; others are cold-stored in WorkspaceManager.
3. Modal exclusivity: at most one modal in ModalStack can be open at a time.
4. Input routing priority: Modal -> FocusArea -> Router -> TextInput. Never skip a level.
5. Generation monotonicity: `chrome_generation` and `pane_generations` only increase, never decrease or reset within a workspace session. Exception: `pane_generations` is cleared on workspace switch because it is an entirely new pane set.
6. IME proxy lifecycle: every pane with keyboard focus must have an active IME proxy; proxy must be synced on every event.
7. Hexagonal dependency direction: inward adapters (`adapter/inward/`) MUST NOT directly mutate domain state. They call inward port trait methods only. Enforced by `scripts/lint-arch.sh`.

## Hexagonal Layer Rules (MUST)

The codebase follows hexagonal architecture. Dependency direction is strictly enforced.

```text
adapter/inward/ -> application/ports/inward/ -> application/services/ -> domain/
                                                     ↓
                                               application/ports/outward/ -> adapter/outward/
```

### What each layer can access

| Layer | Can use | Cannot use |
|-------|---------|------------|
| `adapter/inward/*` | Inward port traits (`ActionPort`, `PaneLifecyclePort`, `DockPort`, and similar), domain types for reading (`PaneKind`, `FocusArea` for pattern matching) | Direct mutation of `self.layout`, `self.panes`, `self.focus`, `self.router`, `self.ime`, `self.cache`, `self.assoc` |
| `application/services/*` | Domain types, outward port traits, all App fields | External I/O directly; it must go through outward ports |
| `domain/*` | Only other domain types | Anything in `adapter/` or `application/` |
| `adapter/outward/*` | Outward port traits, which it implements, and external libraries | Inward ports, other outward adapters |

### How inward adapters should work

```rust
// Correct: call a port method.
fn cli_open_browser(&mut self, params: Value) -> Result<Value, CliError> {
    let url = params.get("url").and_then(|v| v.as_str()).map(String::from);
    self.open_browser_pane(url);
    Ok(json!({"pane_id": self.focus.focused}))
}

// Wrong: directly manipulate domain state.
fn cli_render_html(&mut self, params: Value) -> Result<Value, CliError> {
    let new_id = self.layout.split(source, SplitDirection::Horizontal);
    self.panes.insert(new_id, PaneKind::Browser(pane));
    self.focus.focused = Some(new_id);
}
```

### When a port method does not exist

If an inward adapter needs behavior that no existing port provides, add a new method to the appropriate port trait first, then implement it in the corresponding service. Never bypass the port layer.

### Exceptions

- Reading domain state for response building is allowed; only mutation is prohibited.
- `adapter/outward/view/` may read domain state to produce render output.
- `compute_layout()` may be called after port methods if layout recomputation is needed.

## File Structure

- `docs/glossary.md` - single source of truth for domain terms
- `docs/context-map.md` - how bounded contexts relate
- `docs/domain/*.md` - per-context deep dives
- `docs/specs/*.md` - use case specs with business rules
- `docs/testing/behavior-tests.md` - how to write behavior tests
- `crates/tide-app/src/behavior_tests/` - living specification (537+ tests)

## Tooling-Dictated Paths

These paths are fixed by Cargo or build tooling and cannot be moved into the module tree:

| Path | Reason |
|------|--------|
| `crates/alacritty_terminal/` | External library fork. `[patch.crates-io]` requires an independent crate with its own `Cargo.toml`. |
| `crates/tide-app/benches/` | Cargo standard. `cargo bench` only discovers benchmarks in this path. |
| `crates/tide-app/build.rs` | Cargo standard. Build scripts must be at the crate root. |
| `domain/editor/syntaxes/` | `include_str!` requires files relative to the source file, so data files live near the module that includes them. |
