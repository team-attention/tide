# Behavior Tests — Living Specification

`crates/tide-app/src/behavior_tests.rs` is Tide's **executable specification**.
Reading just the test names should tell you what the system does.
Each test traces back to a **Business Rule** in a **Spec**.

## Traceability Chain

```
docs/glossary.md → docs/specs/{feature}.md → behavior_tests.rs → code
     Term              UC + BR                   // UC-N BR-M        impl
```

## Principles

1. **Test name = natural language sentence** — `fn closing_a_dirty_editor_with_file_shows_save_confirm()`
2. **Organized by domain module** — `mod pane_lifecycle`, `mod focus_management`, etc.
3. **Spec-linked** — each module references its spec file, each test references its BR
4. **Red-Green** — write tests before implementing the feature
5. **Pure functions first** — prefer structures testable without GPU/PTY

## Annotation Format

```rust
mod pane_lifecycle {
    // Spec: docs/specs/pane-lifecycle.md          ← module → spec link

    // --- UC-1: CreateTab ---                     ← UC section separator

    #[test]
    fn new_terminal_tab_creates_launcher_pane() {
        // UC-1 BR-1: New tab is always a Launcher ← BR reference
        ...
    }
}
```

## Current Module Structure

| Module | Spec | Tests | What it verifies |
|--------|------|-------|------------------|
| `pane_lifecycle` | `pane-lifecycle.md` | 13 | Create, split, close, dedup open |
| `modal_behavior` | `modal.md` | 15 | Modal priority, ESC dismiss, input blocking |
| `focus_management` | `input-routing.md` UC-3 | 10 | Focus switching, zoom, file tree toggle |
| `keyboard_routing` | `input-routing.md` UC-1 | 9 | Key routing through modal/focus chain |
| `text_input_routing` | `input-routing.md` UC-2 | 9 | Text routing target resolution |
| `global_actions` | `input-routing.md` UC-4 | 10 | GlobalAction dispatch |
| `editor_behavior` | `editor.md` | 8 | Text input, dirty detection, preview mode |
| `preview_scroll` | `editor.md` UC-3 | 8 | j/k/d/u/g/G scroll, clamp |
| `workspace_behavior` | `workspace.md` | 8 | Switch, close, wrap-around, sidebar |
| `launcher_behavior` | `launcher.md` | 6 | Launcher resolution, Korean IME, invalid choices |
| `search_behavior` | `search.md` | 6 | Search query, match navigation, wrap |
| `ime_behavior` | `ime.md` | 8 | Composition lifecycle, cleanup on switch/close |
| `render_cache_behavior` | `terminal-sync.md` UC-2 | 5 | Cache invalidation, generation tracking |
| `theme_behavior` | `theme.md` | 4 | Theme toggle, font default, cache clear |
| `session_behavior` | `session.md` | 3 | Session serialization, restore, defaults |
| `file_tree_scroll` | `file-tree.md` | 3 | Scroll clamping, hidden preservation |

## Writing a New Test

### Step 1: Check the spec

Find the spec file in `docs/specs/`. If none exists, create one first (see CLAUDE.md).

### Step 2: Identify the Use Case and Business Rule

Your test should verify a specific BR from the spec. If the behavior isn't in the spec, add it.

### Step 3: Add to the matching module

```rust
#[cfg(test)]
mod drag_drop_behavior {
    // Spec: docs/specs/pane-lifecycle.md — UC-6: DragDropPane
    ...
}
```

### Step 4: Name it as a natural language sentence

```rust
// Good — reading it tells you the behavior
fn dragging_pane_to_left_zone_creates_vertical_split()
fn dropping_on_workspace_sidebar_moves_pane_to_that_workspace()
fn drag_cancelled_on_escape_key()

// Bad — unclear what's being verified
fn test_drag()
fn drag_works()
fn check_split()
```

### Step 5: Reference the BR in a comment

```rust
#[test]
fn closing_a_dirty_editor_with_file_shows_save_confirm() {
    // UC-5 BR-10: Dirty Editor with file_path → show SaveConfirm modal
    let (mut app, id) = app_with_editor();
    ...
}
```

### Step 6: Assert invariants

Always verify relevant invariants at the end of your test:

```rust
// PaneId sync invariant
assert!(app.panes.contains_key(&new_id));
assert!(app.layout.pane_ids().contains(&new_id));

// Modal exclusivity invariant
assert!(app.modal.file_finder.is_none() || app.modal.git_switcher.is_none());
```

### Step 7: Update the spec Tests table

Add a row to the spec's Tests table mapping UC → BR → test name.

## Running Tests

```bash
# All behavior tests
cargo test -p tide-app behavior_tests

# Specific module
cargo test -p tide-app behavior_tests::pane_lifecycle

# Specific test
cargo test -p tide-app closing_a_dirty_editor_with_file_shows_save_confirm
```

## New Feature Checklist

When implementing a new feature:

- [ ] Does `docs/glossary.md` need new terms? Added them?
- [ ] Does `docs/specs/{feature}.md` exist? Created UC + BRs?
- [ ] Which Bounded Context (crate) does this belong to?
- [ ] Did you write behavior tests with BR references first?
- [ ] Are test names natural language sentences?
- [ ] Do tests assert relevant invariants?
- [ ] Did you update the spec's Tests table?
- [ ] Do existing tests still pass? (`cargo test -p tide-app`)
