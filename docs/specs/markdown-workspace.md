# Spec: Markdown Workspace

## Overview

### As-Is
Markdown panes already support authoring-first open behavior, Soft Wrap, and preview-only mode through `EditorPane`. Preview-only mode is useful for reading, but it replaces the authoring surface completely. The current EditorPane does not provide a side-by-side Markdown view inside one Pane, so users cannot keep editing active while also seeing rendered Markdown output. The current split preview slice also rebuilds authoring `WrapMap` data and rendered preview lines inside read-only render and click paths instead of preparing them from mutable Pane cache state first.

### To-Be
Markdown panes support a split preview mode inside a single EditorPane. The left side remains the active authoring surface and the right side shows a live rendered Markdown preview. Split preview is available only for Markdown panes and uses standard Markdown rendering only. Preview-only mode remains available as a separate reading mode and is not replaced by split preview. While split preview is visible, the authoring region reuses the Pane's cached `WrapMap` for its own region width and the preview region reuses cached preview lines keyed by content, width, and theme.

### Approach
1. Add split preview state to `EditorPane` as a Markdown-only mode that stays mutually exclusive with preview-only mode.
2. Use `Cmd+Alt+Shift+M` on macOS and `Ctrl+Alt+Shift+M` elsewhere as the split preview toggle path.
3. Keep authoring active while split preview is visible, including routed text input and cursor movement on the authoring side.
4. Render split preview inside the same Pane rectangle by reserving a right-side preview region and keeping preview-only mode unchanged.
5. Prepare split preview cache state during mutable pre-render so grid rendering, cursor rendering, scrollbar sizing, and click-to-cursor reuse the same authoring `WrapMap` and preview cache.
6. Leave backlinks, graph views, and non-standard Markdown syntax out of this slice.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `domain/pane` | Owns split preview mode state and Markdown-only preview-mode transitions for `EditorPane`. |
| `domain/pane/editor_rendering` | Splits the Pane content area into authoring and preview regions and renders live Markdown preview in the preview region. |
| `application/services` | Maps the split preview toggle hotkey and keeps preview-only mode behavior intact. |

## Use Cases

### UC-1: ToggleSplitPreview
- **Actor**: User
- **Trigger**: `Cmd+Alt+Shift+M` or `Ctrl+Alt+Shift+M`
- **Precondition**: The focused Pane is an `EditorPane`
- **Flow**:
  1. The user presses the split preview toggle hotkey.
  2. If the Pane is Markdown, split preview toggles on or off.
  3. If the Pane is not Markdown, the request is ignored.
- **Postcondition**: Markdown panes can show a split preview without replacing the authoring surface.
- **Business Rules**:
  - BR-1: Split preview can be enabled only on Markdown panes.
  - BR-2: The split preview toggle path is `Cmd+Alt+Shift+M` on macOS and `Ctrl+Alt+Shift+M` elsewhere.
  - BR-3: Enabling split preview keeps `preview_mode = false`.

### UC-2: AuthorWithSplitPreviewVisible
- **Actor**: User
- **Trigger**: Text input while split preview is enabled
- **Precondition**: The focused Pane is a Markdown EditorPane with split preview enabled
- **Flow**:
  1. The user enables split preview.
  2. The user continues editing in the authoring region.
  3. The Pane renders the live Markdown preview in the preview region.
- **Postcondition**: The editor buffer remains active while preview stays visible.
- **Business Rules**:
  - BR-4: Routed text input continues to mutate the Markdown buffer while split preview is visible.
  - BR-5: Split preview rendering uses standard Markdown only.
  - BR-8: Split preview authoring reuses a cached `WrapMap` built for the authoring region width across grid, cursor, scrollbar, and click-to-cursor paths.
  - BR-9: Split preview preview lines come from `preview_cache`, keyed by content generation, preview region width, and theme.

### UC-3: PreservePreviewOnlyMode
- **Actor**: User
- **Trigger**: Preview-only toggle while split preview is enabled
- **Precondition**: The focused Pane is a Markdown EditorPane
- **Flow**:
  1. The user enables split preview.
  2. The user triggers preview-only mode with the existing preview toggle path.
  3. The Pane exits split preview and enters preview-only mode.
- **Postcondition**: Preview-only mode behavior stays intact and remains distinct from split preview.
- **Business Rules**:
  - BR-6: Entering preview-only mode disables split preview first.
  - BR-7: Split preview never changes the existing preview-only toggle path.

## Invariants

1. Split preview is available only for Markdown panes.
2. Split preview and preview-only mode are mutually exclusive.
3. Split preview keeps the authoring surface active and visible.
4. This slice uses only standard Markdown rendering and does not add backlinks or graph features.
5. Split preview authoring never rebuilds `WrapMap` inside immutable render paths when the current authoring cache is already valid.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `markdown_workspace_behavior` | `split_preview_toggle_is_ignored_for_non_markdown_panes` |
| UC-1 | BR-2 | `markdown_workspace_behavior` | `split_preview_toggle_enables_markdown_panes` |
| UC-1 | BR-3 | `markdown_workspace_behavior` | `split_preview_toggle_keeps_preview_only_mode_disabled` |
| UC-2 | BR-4 | `markdown_workspace_behavior` | `text_input_keeps_authoring_active_while_split_preview_is_visible` |
| UC-2 | BR-8 | `markdown_workspace_behavior` | `split_preview_click_refreshes_wrap_map_for_authoring_region_width` |
| UC-2 | BR-9 | `markdown_workspace_behavior` | `split_preview_prepare_caches_uses_preview_region_width` |
| UC-3 | BR-6 | `markdown_workspace_behavior` | `preview_only_toggle_disables_split_preview` |

## Location

| What | Location |
|------|----------|
| Markdown workspace spec | `docs/specs/markdown-workspace.md` |
| Behavior tests | `crates/tide-app/src/application/behavior_tests/markdown_workspace_behavior.rs` |
| EditorPane state | `crates/tide-app/src/domain/pane/editor.rs` |
| Split preview rendering | `crates/tide-app/src/domain/pane/editor_rendering.rs` |
| Toggle routing | `crates/tide-app/src/application/services/action_service/mod.rs` |
