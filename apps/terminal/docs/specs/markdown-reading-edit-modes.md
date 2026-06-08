# Spec: Markdown Reading / Edit Modes

## Overview

### As-Is
Markdown Panes (Editor Panes backed by a `.md`/`.markdown`/… file) currently open
with `live_preview = true` (LivePreviewMode), the Obsidian-style inline hybrid
that renders styled markdown in the same coordinate space as the raw buffer
(`domain/editor/markdown.rs`, `domain/pane/editor_rendering.rs`). Three modes
exist on `EditorPane`:

- **Plain** — raw markdown + syntax highlighting (`preview_mode = false`,
  `live_preview = false`).
- **Preview** — read-only formatted rendering via `render_markdown_preview`
  (`preview_mode = true`); clean `PreviewLine`/`StyledSpan` output.
- **LivePreviewMode** — inline hybrid (`live_preview = true`); per-line
  recomputation of table cell ranges, code-fence bounds, syntax-marker dimming,
  gutter, etc.

`EditorPane::open` sets `live_preview = Self::is_markdown_extension(path)`. The
Editor Chrome header badge (`view/header.rs` ~127) exposes only
`HeaderHitAction::ToggleLivePreview` (`plain ↔ live`). The read-only Preview mode
(`toggle_preview`, mutually exclusive with `live_preview`) is reachable in code
but is not the markdown default and is not the primary header toggle.

Problems (the LivePreviewMode hybrid):
- On a monospace grid it cannot scale heading fonts, draws tables as grid cells,
  cannot render images/badges, and still surfaces raw markers / line numbers /
  raw HTML — so a long document reads like colored source, not a document.
- It carries heavy per-line recomputation and a large amount of intertwined
  rendering code (table/code-block bounds, marker hiding, source-table cache).

This supersedes the default-mode decision in `docs/specs/live-preview.md`
(UC-0 "OpenMarkdownInLivePreview"): Markdown Panes no longer open in
LivePreviewMode.

### To-Be
A Markdown Pane has two primary modes the user toggles between, like a
conventional markdown editor:

- **Reading mode** = the existing read-only **Preview** (`preview_mode = true`),
  the clean formatted rendering. Markdown Panes **open in Reading mode**.
- **Source mode** = **Plain** (raw markdown + syntax highlighting), for editing.

The Editor Chrome header exposes one toggle that switches **Reading ↔ Source**
(`HeaderHitAction::TogglePreview` → `EditorPane::toggle_preview`). The badge label
names the action the click performs: it reads `edit` while in Reading mode and
`read` while in Source mode.

LivePreviewMode is **fully removed** — both as a user-facing mode and as code.
Markdown rendering is exactly two modes — Reading (read-only Preview) and Source
(Plain). The shared read-only Preview renderer (`render_markdown_preview`,
`MarkdownTheme`, `PreviewLine`) powers Reading mode.

**Soft Wrap decoupling (evidence-based).** The `live_preview_*` "Fixed-Width
Block" machinery looked load-bearing for general Soft Wrap horizontal scrolling
(`handle_soft_wrap_horizontal_scroll_action` is called from `handle_action` /
`handle_action_with_size` for all prose files). But the evidence showed it was
gated end-to-end on `live_preview_map`, which was only built in LivePreviewMode —
so in Source/Reading it always returned `None` and the feature never actually ran
(Soft Wrap has no horizontal scroll; the handler just pins `h_scroll = 0`).
`handle_soft_wrap_horizontal_scroll_action` was therefore simplified to that
no-op and the entire fixed-width cluster deleted with no behavior change
(verified by the full Soft Wrap test suite).

### Approach (done)
1. `EditorPane::open`: open Markdown in Reading mode (`preview_mode = true`).
2. Header badge toggles Reading ↔ Source via `HeaderHitAction::MarkdownPreview`
   (label `edit` in Reading / `read` in Source); removed `ToggleLivePreview` +
   click routing, `GlobalAction::ToggleLivePreview`, and the live-preview branch
   in `editor_plain_click_col`.
3. Deleted `live_preview_tests.rs` + its module entry; migrated remaining
   markdown tests to the two-mode model (Reading default via `open`;
   authoring/soft-wrap/list tests switch to Source `preview_mode = false`).
4. Physically deleted all LivePreviewMode internals: `EditorPane` fields
   (`live_preview`, `live_preview_map`, `live_preview_generation`,
   `live_preview_source_table_cache`, `live_preview_fixed_width_h_scroll`) and
   methods; the `live_preview_*` render path + helpers in `editor_rendering.rs`;
   `LivePreviewMap` / `MdElement` / `MdElementKind` + ~830 lines in `markdown.rs`;
   the live-preview URL extraction in `text_extract_service`; and the
   `editor_live_preview_vertical_padding` theme inset. Verified no markdown dead
   code remains under `#![warn(dead_code)]`.
5. Updated glossary (removed `LivePreviewMode` / `LivePreviewMap` /
   `Fixed-Width Live Preview Block`) and marked `docs/specs/live-preview.md`
   superseded.

## Bounded Contexts
- editor (`domain/editor/`) — markdown parsing / `render_markdown_preview` (unchanged).
- pane (`domain/pane/editor.rs`) — `EditorPane::open` default mode; `toggle_preview`.
- view (`adapter/outward/view/header.rs`) — Editor Chrome badge + `HeaderHitAction`.
- input (`adapter/inward/click_adapter/header.rs`) — header action → pane method.

## Use Cases

### UC-1: OpenMarkdownInReadingMode
Actor: System
Trigger: A Markdown file-backed Editor Pane is opened.
Precondition: The opened file has a Markdown extension.
Flow: `EditorPane::open` detects the Markdown extension and opens the Pane in
Reading mode.
Postcondition: `preview_mode == true`, `live_preview == false`.
Business Rules:
- BR-1: A Markdown Pane opens with `preview_mode == true`.
- BR-2: A Markdown Pane opens with `live_preview == false` (LivePreviewMode is
  not the default).
- BR-3: A non-Markdown Editor Pane still opens in Source mode
  (`preview_mode == false`).

### UC-2: ToggleReadingAndSource
Actor: User
Trigger: User clicks the markdown mode badge in the Editor Chrome header.
Precondition: The active Pane is a Markdown Pane.
Flow: The header badge action `TogglePreview` calls `toggle_preview`, switching
Reading ↔ Source.
Postcondition: `preview_mode` is inverted; `live_preview` stays `false`.
Business Rules:
- BR-4: In Reading mode the badge label is `edit` and its action is
  `TogglePreview`.
- BR-5: In Source mode the badge label is `read` and its action is
  `TogglePreview`.
- BR-6: The markdown header badge never offers `ToggleLivePreview`.
- BR-7: Toggling from Reading enters Source (`preview_mode == false`) and vice
  versa, with `live_preview` remaining `false`.

### UC-3: ReadingViewVisualTreatment
Actor: System
Trigger: `render_markdown_preview` renders Markdown to `PreviewLine`s for Reading
mode.
Precondition: The pane is a Markdown Pane in Reading mode.
Flow: Markdown blocks render into the monospace grid with document-like framing
(within the grid's constraints — no proportional fonts).
Postcondition: A clean reading view with clear block hierarchy and tight rhythm.
Business Rules:
- BR-8: An `h1` heading is followed by a full-width underline rule line of `═`
  (box double-line); an `h2` heading by a `─` rule line. The rule spans the
  heading's text width and uses the heading color. `h3`–`h6` get no rule.
- BR-9: Consecutive blank `PreviewLine`s collapse to a single blank — block
  spacing is exactly one row, never doubled.
- BR-10: A fenced code block frames its content with a tinted background; when a
  language is given, the language tag renders on the code block's top frame line
  (not a separate extra row).

## Invariants
- INV-1: A Markdown Pane is never in both `preview_mode` and `live_preview` at
  once (existing mutual exclusion preserved).
- INV-2: The normal markdown open/toggle flow never sets `live_preview = true`.
- INV-3: Reading view never emits two consecutive blank `PreviewLine`s.

## Tests
| UC | BR | Test (`behavior_tests/...`) |
|----|----|------------------------------|
| UC-1 | BR-1 | `markdown_file_opens_in_reading_mode` |
| UC-1 | BR-2 | `markdown_file_opens_without_live_preview` |
| UC-1 | BR-3 | `non_markdown_file_opens_in_source_mode` |
| UC-2 | BR-4 | `reading_mode_badge_offers_edit` |
| UC-2 | BR-5 | `source_mode_badge_offers_read` |
| UC-2 | BR-6 | `markdown_badge_never_offers_live_preview` |
| UC-2 | BR-7 | `toggling_markdown_mode_switches_reading_and_source` |
| UC-3 | BR-8 | `reading_view_h1_and_h2_get_underline_rules` |
| UC-3 | BR-9 | `reading_view_collapses_consecutive_blank_lines` |
| UC-3 | BR-10 | `reading_view_code_block_tags_language_on_frame` |

## Location
- `crates/tide-app/src/domain/pane/editor.rs` (`open`, `toggle_preview`)
- `crates/tide-app/src/adapter/outward/view/header.rs` (badge, `HeaderHitAction`)
- `crates/tide-app/src/adapter/inward/click_adapter/header.rs` (action routing)
- Tests: `crates/tide-app/src/application/behavior_tests/editor_behavior.rs`,
  `.../view/header.rs` badge unit tests.
