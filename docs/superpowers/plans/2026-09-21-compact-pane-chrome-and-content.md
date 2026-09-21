# Compact Pane Chrome and Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tide's aligned header surfaces compact, remove the base content inset from terminal and file-oriented panes, and stop the stacked Terminal Context Surface identity from crowding its pane tabs.

**Architecture:** Keep chrome spacing separate from pane-content geometry. Introduce one 32 px source of truth for the aligned titlebar, pane tab bar, and file-tree header; make `pane_content_rect` represent the full area below that header; and omit the redundant identity badge only in stacked Terminal Context Surface mode. Rendering, layout, resize, cursor, selection, hit-testing, IME, scrolling, and text extraction must all derive from the same content rectangle.

**Tech Stack:** Rust 2021, Tide `tide-app`, wgpu renderer, Cargo behavior tests, macOS app bundle.

**Specs:** `apps/terminal/docs/specs/pane-chrome.md`, `apps/terminal/docs/specs/terminal-pane-inset.md`

## Global Constraints

- Change only the three requested UI behaviors; do not include the separate GPU-memory work.
- Use `32.0` logical pixels for all aligned header bands.
- Preserve `PANE_PADDING = 12.0` for titlebar controls, popups, badges, navigation chrome, and other non-content UI.
- Remove base left, right, bottom, and terminal half-cell top insets from pane content.
- Preserve semantic indentation inside the file tree and readable-column centering inside Markdown preview; these are not pane-edge insets.
- In stacked Terminal Context Surface mode, render no identity badge. In split mode, render only `Context: <owner>` with the existing 24-character owner truncation.
- Do not commit, push, merge, tag, or deploy unless the user asks after reviewing the result.

---

### Task 1: Unify and reduce aligned header heights

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/theme.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/pane_chrome_behavior.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/visual_hierarchy.rs`
- Modify: `apps/terminal/docs/specs/pane-chrome.md`

**Interfaces:**

- Produces: `HEADER_BAR_HEIGHT: f32 = 32.0`
- Produces: `TITLEBAR_HEIGHT`, `TAB_BAR_HEIGHT`, and `FILE_TREE_HEADER_HEIGHT` as aliases of `HEADER_BAR_HEIGHT`
- Preserves: `HEADER_ACTION_TILE_SIZE = 18.0` and existing vertical-centering formulas

- [ ] **Step 1: Add failing regression tests for the shared 32 px height**

Replace the current `TAB_BAR_HEIGHT >= 35.0` regression with exact expectations:

```rust
assert_eq!(crate::theme::HEADER_BAR_HEIGHT, 32.0);
assert_eq!(crate::theme::TITLEBAR_HEIGHT, crate::theme::HEADER_BAR_HEIGHT);
assert_eq!(crate::theme::TAB_BAR_HEIGHT, crate::theme::HEADER_BAR_HEIGHT);
assert_eq!(
    crate::theme::FILE_TREE_HEADER_HEIGHT,
    crate::theme::HEADER_BAR_HEIGHT,
);
```

Also assert that the existing titlebar icon/button height and `HEADER_ACTION_TILE_SIZE` fit inside the 32 px band.

- [ ] **Step 2: Run the focused tests and confirm they fail on the old 40/35/38 values**

Run from `apps/terminal`:

```bash
cargo test -p tide-app pane_chrome_behavior
cargo test -p tide-app visual_hierarchy
```

Expected: the new exact-height assertion fails before implementation.

- [ ] **Step 3: Add the shared height constant**

In `theme.rs`, replace the three independent heights with:

```rust
pub const HEADER_BAR_HEIGHT: f32 = 32.0;
pub const TAB_BAR_HEIGHT: f32 = HEADER_BAR_HEIGHT;
pub const TITLEBAR_HEIGHT: f32 = HEADER_BAR_HEIGHT;
pub const FILE_TREE_HEADER_HEIGHT: f32 = HEADER_BAR_HEIGHT;
```

Do not reduce icon sizes. Existing expressions based on these constants should center text, buttons, active indicators, drag regions, and hit rectangles automatically.

- [ ] **Step 4: Audit header geometry for stale literals**

Search for `35.0`, `38.0`, `40.0`, and all three old constants. Any layout or hit-test representing one of the aligned header bands must use the shared constant or its role-specific alias. Unrelated 32/35/38/40 px dimensions must remain unchanged.

- [ ] **Step 5: Update the pane chrome specification and rerun focused tests**

Update `pane-chrome.md` so the shared titlebar, tab bar, and file-tree header requirement is exactly 32 logical pixels. Remove the old requirement that shared tabs be at least 35 px tall.

Run:

```bash
cargo test -p tide-app pane_chrome_behavior
cargo test -p tide-app visual_hierarchy
```

Expected: PASS.

---

### Task 2: Remove terminal and file-pane base content insets

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/domain/pane/mod.rs`
- Modify: `apps/terminal/crates/tide-app/src/theme.rs`
- Modify: `apps/terminal/crates/tide-app/src/layout_compute.rs`
- Modify as required by the padding audit:
  - `apps/terminal/crates/tide-app/src/adapter/inward/mouse_adapter/mod.rs`
  - `apps/terminal/crates/tide-app/src/adapter/inward/mouse_adapter/selection.rs`
  - `apps/terminal/crates/tide-app/src/adapter/inward/scroll_adapter/mod.rs`
  - `apps/terminal/crates/tide-app/src/adapter/inward/search_adapter/mod.rs`
  - `apps/terminal/crates/tide-app/src/adapter/outward/view/overlays/completions.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/terminal_pane_inset.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/terminal_text_interaction.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/editor_viewport_behavior.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/preview_scroll.rs`
- Modify: `apps/terminal/docs/specs/terminal-pane-inset.md`

**Interfaces:**

- Changes: `pane_content_rect(pane_rect, content_top_offset)` returns the full pane width and all remaining height below the header
- Changes: `terminal_content_top(cell_height)` becomes exactly `TAB_BAR_HEIGHT`; remove the now-unused `cell_height` parameter if all call sites can be migrated cleanly
- Removes: `TERMINAL_TOP_PADDING_CELLS` and `terminal_top_padding`
- Preserves: `PANE_PADDING` for non-content chrome

- [ ] **Step 1: Rewrite the inset behavior tests to describe flush content**

The core geometry expectation becomes:

```rust
let content = crate::pane::pane_content_rect(pane_rect, TAB_BAR_HEIGHT);
assert_eq!(content.x, pane_rect.x);
assert_eq!(content.y, pane_rect.y + TAB_BAR_HEIGHT);
assert_eq!(content.width, pane_rect.width);
assert_eq!(content.height, pane_rect.height - TAB_BAR_HEIGHT);
```

Terminal assertions must expect the first row, cursor, IME area, selection, and pointer mapping to start at `(pane_rect.x, pane_rect.y + TAB_BAR_HEIGHT)`. Editor, preview, and diff viewport assertions must expect the same base rectangle before their own semantic gutters or readable-column logic.

- [ ] **Step 2: Run the focused tests and confirm they fail with the current 12 px and half-cell insets**

Run:

```bash
cargo test -p tide-app terminal_pane_inset
cargo test -p tide-app terminal_text_interaction
cargo test -p tide-app editor_viewport_behavior
cargo test -p tide-app preview_scroll
```

Expected: the new origin and size assertions fail before implementation.

- [ ] **Step 3: Make `pane_content_rect` flush with pane edges**

Change the helper to the equivalent of:

```rust
pub(crate) fn pane_content_rect(pane_rect: Rect, content_top_offset: f32) -> Rect {
    Rect::new(
        pane_rect.x,
        pane_rect.y + content_top_offset,
        pane_rect.width,
        (pane_rect.height - content_top_offset).max(1.0),
    )
}
```

This single helper remains the source of truth for terminal, editor/source, Markdown preview, diff, browser content, and launcher base geometry.

- [ ] **Step 4: Remove the terminal-only half-cell top inset**

Delete `TERMINAL_TOP_PADDING_CELLS` and `terminal_top_padding`. Make every terminal content origin resolve directly to the bottom edge of the tab bar. If retaining `terminal_content_top` avoids noisy call-site churn, make it parameterless and return `TAB_BAR_HEIGHT`; otherwise replace its callers with `TAB_BAR_HEIGHT` and remove it completely.

- [ ] **Step 5: Replace direct content-padding arithmetic with the shared rectangle**

Audit every `PANE_PADDING` use. Update only uses that calculate pane body origin, terminal grid size, editor body size, selection coordinates, pointer mapping, scroll rows, search rows, or completion overlay positions. In particular:

- `layout_compute.rs`: terminal PTY columns/rows must use `pane_content_rect`, not `vr.x + PANE_PADDING` or `vr.width - 2 * PANE_PADDING`.
- `mouse_adapter/mod.rs` and `mouse_adapter/selection.rs`: pointer and selection coordinates must use the same rectangle as rendering.
- `scroll_adapter/mod.rs` and `search_adapter/mod.rs`: visible row/column capacity must use the full content width/height.
- `overlays/completions.rs`: editor completion placement must start from the editor content rectangle plus the editor gutter, not a second pane padding.

Do not alter titlebar control margins, popup margins, save/search bar padding, browser navigation padding, file-tree hierarchy indentation, or Markdown readable-column centering.

- [ ] **Step 6: Replace the old inset specification**

Rewrite `terminal-pane-inset.md` to require no base pane-edge inset and one shared origin for render, resize, hit-test, cursor, IME, selection, and text extraction. Remove statements requiring `PANE_PADDING` on terminal sides or a cell-relative top inset.

- [ ] **Step 7: Run all content-geometry tests**

Run:

```bash
cargo test -p tide-app terminal_pane_inset
cargo test -p tide-app terminal_text_interaction
cargo test -p tide-app editor_viewport_behavior
cargo test -p tide-app preview_scroll
cargo test -p tide-app soft_wrap_behavior
cargo test -p tide-app markdown_workspace_behavior
```

Expected: PASS, with terminal backend dimensions and rendered grid dimensions still matching after resize.

---

### Task 3: Free stacked context-header space for pane tabs

**Files:**

- Modify: `apps/terminal/crates/tide-app/src/adapter/outward/view/header.rs`
- Modify: `apps/terminal/crates/tide-app/src/adapter/outward/view/chrome/tab_bar.rs`
- Modify: `apps/terminal/crates/tide-app/src/application/behavior_tests/visual_hierarchy.rs`
- Modify: `apps/terminal/docs/specs/pane-chrome.md`

**Interfaces:**

- Changes: `terminal_context_surface_header_identity_label(app, context_pane_id)` returns `None` when the owning context surface is stacked
- Changes: split-mode identity text becomes `Context: <compacted owner>`
- Preserves: the leading stacked/split view-mode icon and all pane tab labels/actions

- [ ] **Step 1: Add failing tests for stacked and split identity behavior**

Add exact assertions:

```rust
// Stacked: no identity width is reserved; tabs begin after the view-mode action.
assert_eq!(
    terminal_context_surface_header_identity_label(&app, first_context_id),
    None,
);

// Split: retain ownership without redundant mode/count text.
assert_eq!(
    terminal_context_surface_header_identity_label(&app, second_context_id).as_deref(),
    Some("Context: tide-workbench"),
);
```

Update the unit tests in `header.rs` so a long split owner still truncates at the existing 24-character limit and the result contains neither `/ split` nor `/ N panes`.

- [ ] **Step 2: Run the focused tests and confirm the current verbose label fails them**

Run:

```bash
cargo test -p tide-app terminal_context_surface_identity
cargo test -p tide-app terminal_context_surface_header_identity
```

Expected: tests fail because current output is `Context: <owner> / <mode> / <count> panes`.

- [ ] **Step 3: Omit stacked identity and compact split identity**

In `chrome/tab_bar.rs`, inspect the owning terminal's `dock_view_mode` before creating the label. Return `None` for `ViewMode::Stacked`. For `ViewMode::Split`, call a simplified formatter in `header.rs` that produces only:

```text
Context: <compacted owner>
```

Remove obsolete mode/count parameters and update all call sites. Do not return an empty string: `None` must flow through the existing optional identity path so no badge padding or width is reserved.

- [ ] **Step 4: Verify tab width and scrolling behavior**

Add or update a geometry assertion proving that a stacked context header reserves width only for the leading view-mode action and right-side action strip, not for an identity badge. Confirm auto-fit and manual tab scrolling still use the rendered bounds.

- [ ] **Step 5: Update the pane chrome specification and rerun focused tests**

Document that stacked context tabs take precedence over redundant surface identity, while split context headers retain the compact owner label.

Run:

```bash
cargo test -p tide-app pane_chrome_behavior
cargo test -p tide-app visual_hierarchy
```

Expected: PASS.

---

### Task 4: Integrated verification and manual macOS check

**Files:** None unless verification exposes a regression directly caused by Tasks 1–3.

- [ ] **Step 1: Format and inspect the diff**

Run from `apps/terminal`:

```bash
cargo fmt --all -- --check
git diff --check
git diff --stat
```

Expected: no formatting or whitespace errors; only files named by this plan are changed.

- [ ] **Step 2: Run the complete `tide-app` test suite**

```bash
cargo test -p tide-app
```

Expected: PASS.

- [ ] **Step 3: Build the macOS application bundle**

```bash
./scripts/build-app.sh
```

Expected: `target/release/bundle/osx/Tide Terminal.app` is built and ad-hoc signed successfully.

- [ ] **Step 4: Manually verify the three requested behaviors**

Open a workspace containing a Stage terminal, a stacked four-pane Terminal Context Surface, an editor/source file, a Markdown preview or diff, and File Tree View. Confirm:

1. Titlebar, pane tab bar, and file-tree header form one 32 px aligned band.
2. Icons, close buttons, active indicators, drag targets, and tab clicks remain vertically centered and clickable.
3. Terminal row 0 begins immediately below the header and at the pane's left edge.
4. Editor/source, preview, and diff use the full pane body before their semantic gutter/centering rules.
5. Terminal selection, hyperlinks, cursor, IME preedit, search, scroll, and resize remain aligned with rendered cells.
6. Stacked context mode shows no `Context: ... / stacked / N panes` badge and exposes the recovered width to pane tabs.
7. Split context mode shows only `Context: <owner>`.

- [ ] **Step 5: Record before/after screenshots and stop for review**

Capture the same layouts as the user's two reference screenshots. Report the changed files, focused-test results, full-test result, and bundle-build result. Do not commit or deploy without a separate user request.

## Plan Critique

- Setting global `PANE_PADDING` to zero would also collapse unrelated titlebar, popup, and control spacing, so this plan deliberately changes only pane-body geometry.
- Removing only visual padding would desynchronize terminal rendering from PTY sizing and input mapping, so every geometry consumer is included in the audit and tests.
- Keeping a shortened identity badge in stacked mode would still steal tab width despite the information being visible through the mode control and tabs themselves, so stacked mode uses `None` rather than abbreviated text.
- A 32 px header is the smallest shared value that still contains the existing titlebar button geometry and 18 px header actions without resizing icons.
