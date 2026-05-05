# Spec: Editor Pane Revamp

## Overview

### As-Is
Tide's editor work is currently split across focused specs:
`docs/specs/editor.md` covers core authoring and preview behavior,
`docs/specs/soft-wrap.md` covers prose wrapping, `docs/specs/editor-polish.md`
covers `Editor Chrome`, and `docs/specs/editor-ide-polish.md` covers
`CompletionPopup` polish. Those specs protect important pieces, but they do not
define one product-level contract for the `Editor Pane` as a serious writing and
coding surface.

The current implementation already has the required building blocks:
`EditorState` owns the buffer, cursor, undo stack, and syntax highlighting;
`EditorPane` owns mode state, `Soft Wrap`, `WrapMap`, selection, search,
preview cache, `LivePreviewMode`, and `CompletionPopup`; the renderer draws
grid content separately from overlay cursor, selection, search, and scrollbar
chrome. That split makes performance possible, but it also creates failure
points: cursor-row chrome can live in the cached grid while the cursor itself
lives in the overlay layer; authoring, preview, live preview, soft wrap, click
mapping, selection, and IME cursor areas each compute related geometry through
slightly different paths.

The visual issue is therefore not just color. The `Editor Pane` can feel light,
cheap, or fragile when the document background, current-line chrome, selection
rects, code-block backgrounds, cursor overlay, and scroll state do not move as
one system. User research against VS Code, Warp, and Zed points to a stronger
contract: editor surfaces should have stable viewport geometry, deliberate
cursor and scroll behavior, predictable Markdown authoring, restrained state
color, and document chrome that feels desktop-native rather than decorative.

### To-Be
The `Editor Pane` is revamped as one coherent surface without replacing
`EditorState` or breaking the hexagonal boundaries.

After the revamp:

- all authoring overlay geometry uses one shared `EditorViewport` coordinate
  contract per rendered `Editor Pane`
- grid-cache invalidation accounts for every state that affects cached document
  chrome
- `Soft Wrap`, `LivePreviewMode`, selection, search highlights, cursor, IME, and
  mouse hit-testing use the same viewport width and scroll origin
- scroll input feels continuous and stable while buffer state remains integer
  and deterministic
- Markdown authoring feels like a writing tool: live preview, list continuation,
  code-block treatment, and split preview are predictable
- visual polish keeps the existing icon-aligned palette roles intact and only
  adjusts document-surface treatment where the contract requires it
- `Editor Chrome` communicates active Pane, mode, and file state without toy-like
  badges or high-chroma status noise

### Approach
1. Introduce this top-level spec as the contract that sequences the existing
   editor specs instead of replacing them.
2. Define a shared viewport model for `Editor Pane` rendering, overlay drawing,
   hit-testing, IME cursor areas, and text routing.
3. Add behavior tests for cache invalidation and coordinate consistency before
   each implementation step.
4. Harden scroll and cursor behavior first because misalignment creates the
   strongest impression of fragility.
5. Then improve Markdown authoring behavior inside the existing
   `LivePreviewMode` and `Soft Wrap` architecture.
6. Finally tune document-surface treatment while preserving icon-aligned
   background and highlight color roles.

## Bounded Contexts

| Context | Responsibility |
|---------|----------------|
| `domain/editor` | `EditorState`, buffer mutation, cursor movement, undo, generation, and syntax highlighting. |
| `domain/pane` | `EditorPane` mode state, `Soft Wrap`, `WrapMap`, preview cache, `LivePreviewMode`, selection, search, and completion state. |
| `adapter/outward/view` | Shared rendered viewport geometry, grid rendering, cursor/selection/search overlays, scrollbar, IME cursor areas, and `Editor Chrome`. |
| `adapter/inward` | Mouse, scroll, keyboard, IME, and text routing into the same viewport coordinate model. |
| `application/services` | GlobalAction routing, preview toggles, save flows, LSP notifications, and invalidation. |
| `theme` | Existing icon-aligned palette roles and document-surface tokens. |

## Use Cases

### UC-1: KeepDocumentChromeAndCursorLocked
- **Actor**: User
- **Trigger**: Cursor movement, scroll, selection, search, or IME composition in
  an authoring `Editor Pane`
- **Precondition**: The `Editor Pane` is visible and not in preview mode
- **Flow**:
  1. Tide computes one viewport geometry for the rendered `Editor Pane`.
  2. Grid content, current-line chrome, cursor overlay, selection, search
     highlights, scrollbar markers, and IME cursor area all derive from that
     geometry.
  3. State changes that affect cached grid chrome invalidate the cached Pane.
- **Postcondition**: Cursor, current-line block, selection, and highlights stay
  visually locked during navigation and scroll.
- **Business Rules**:
  - BR-1: Cursor-row-dependent editor chrome must invalidate when the cursor
    moves to another logical line.
  - BR-2: Selection and search highlight rects must use the same authoring rect,
    gutter width, scroll origin, and `WrapMap` as text rendering, and plain
    text selection rects must stop at line content instead of extending to the
    viewport edge.
  - BR-3: IME cursor areas must use the same authoring rect and `WrapMap` as the
    rendered editor cursor.
  - BR-4: Scrollbar markers must use the same logical-to-visual row mapping as
    cursor and selection overlays.

### UC-2: ScrollAuthoringWithoutJank
- **Actor**: User
- **Trigger**: Trackpad, mouse wheel, page navigation, or cursor navigation near
  viewport edges
- **Precondition**: The focused `Editor Pane` has content beyond the viewport
- **Flow**:
  1. Tide accumulates high-resolution scroll input.
  2. The display viewport advances predictably and clamps at valid bounds.
  3. Cached structural maps are not rebuilt for scroll-only movement.
- **Postcondition**: Scroll feels stable and the viewport does not visually tear
  between text, cursor, and block backgrounds.
- **Business Rules**:
  - BR-5: Scroll-only movement must not rebuild `WrapMap` or `LivePreviewMap`.
  - BR-6: Prose scroll must advance in visual rows when `Soft Wrap` is active.
  - BR-7: Scroll input must clamp at valid visual-row bounds before rendering.
  - BR-8: Cursor visibility updates must not desynchronize cached grid chrome
    from overlay cursor chrome.

### UC-3: MakeMarkdownAuthoringFeelNative
- **Actor**: User
- **Trigger**: Typing or navigating in a Markdown-backed `Editor Pane`
- **Precondition**: The file is a Markdown Pane in authoring mode
- **Flow**:
  1. The Pane opens in authoring mode with `LivePreviewMode` and `Soft Wrap`.
  2. Inline syntax hiding, list continuation, code-block treatment, and split
     preview stay predictable.
  3. Preview mode remains an explicit reading mode.
- **Postcondition**: Markdown feels like a first-class writing mode rather than
  a raw text fallback plus separate preview.
- **Business Rules**:
  - BR-9: Markdown authoring keeps `preview_mode = false`,
    `live_preview = true`, and `Soft Wrap` enabled by default.
  - BR-10: `LivePreviewMode` soft-wrap rendering must use displayed content
    width where hidden syntax markers change visible columns.
  - BR-11: Pressing Enter in a Markdown list continues the list marker; pressing
    Enter on an empty list item exits the list.
  - BR-12: Fenced code-block backgrounds must read as stable document blocks,
    not as misaligned row stripes.

### UC-4: PreserveSeriousVisualTone
- **Actor**: User
- **Trigger**: Reading, editing, focusing, or switching modes in an `Editor Pane`
- **Precondition**: The Pane is visible
- **Flow**:
  1. Tide applies document-surface treatment from `DESIGN.md`.
  2. Existing icon-aligned background and highlight color roles are preserved.
  3. Visual weight comes from alignment, contrast, density, and restraint rather
     than saturated color.
- **Postcondition**: The editor feels solid, precise, and desktop-native.
- **Business Rules**:
  - BR-13: Document-surface changes must not globally replace icon-aligned
    background or highlight palette roles.
  - BR-14: Current-line emphasis must stay visible without becoming a bright
    stripe.
  - BR-15: `EditorBadge` color remains secondary to file title and mode clarity.
  - BR-16: Preview and authoring surfaces must feel related but distinct.

### UC-5: StabilizeCodeEditingBasics
- **Actor**: User
- **Trigger**: Typing, accepting completion, navigating by word or line, search,
  save, or paste in a code file
- **Precondition**: The focused `Editor Pane` is not a Markdown-only workflow
- **Flow**:
  1. `EditorState` handles buffer mutation and cursor movement.
  2. `CompletionPopup` ranking and accepted text are deterministic.
  3. Search and selection remain aligned with the viewport.
- **Postcondition**: Code editing feels predictable even before adding larger IDE
  features.
- **Business Rules**:
  - BR-17: Completion ordering and accepted text follow
    `docs/specs/editor-ide-polish.md`.
  - BR-18: Search highlights must stay aligned through horizontal scroll and
    `Soft Wrap`.
  - BR-19: Paste and IME commit follow the same authoring/preview mutation
    rules.

## Invariants

1. This revamp does not replace `EditorState`.
2. Inward adapters must not directly mutate domain state outside existing port
   boundaries.
3. `PaneId` and `SplitLayout` invariants are unchanged.
4. `Editor Pane` geometry must be computed from one viewport contract wherever
   possible.
5. Color is not the primary fix for solidity; geometry and invalidation are.
6. Existing icon-aligned palette roles remain the base visual system unless a
   later spec explicitly changes them.

## Tests

| UC | BR | Test module | Test |
|----|----|-------------|------|
| UC-1 | BR-1 | `editor_polish_behavior` | `cursor_row_movement_invalidates_current_line_chrome` |
| UC-1 | BR-2 | `editor_viewport_behavior` | `selection_rects_share_authoring_viewport_geometry` |
| UC-1 | BR-2 | `editor_viewport_behavior` | `plain_selection_rect_clamps_to_line_content_width` |
| UC-1 | BR-2 | `editor_viewport_behavior` | `multiline_plain_selection_rects_stop_at_each_line_content_width` |
| UC-1 | BR-3 | `editor_viewport_behavior` | `ime_cursor_area_matches_editor_cursor_geometry` |
| UC-1 | BR-4 | `editor_viewport_behavior` | `scrollbar_markers_follow_soft_wrap_visual_rows` |
| UC-2 | BR-5 | `soft_wrap_behavior` | `mouse_wheel_scrolling_wrapped_markdown_stays_monotonic_and_keeps_cache_maps_stable` |
| UC-2 | BR-6 | `soft_wrap_behavior` | `scrolling_wrapped_markdown_advances_by_visual_row` |
| UC-2 | BR-7 | `soft_wrap_behavior` | `scrolling_wrapped_markdown_reaches_the_last_visual_row` |
| UC-3 | BR-9 | `editor_behavior` | `markdown_file_opens_in_authoring_mode_with_live_preview_enabled` |
| UC-3 | BR-10 | `live_preview_tests` | `live_preview_soft_wrap_uses_displayed_columns_for_hidden_syntax` |
| UC-3 | BR-11 | `markdown_authoring_behavior` | `markdown_enter_continues_list_marker` |
| UC-3 | BR-11 | `markdown_authoring_behavior` | `markdown_enter_increments_ordered_list_marker` |
| UC-3 | BR-11 | `markdown_authoring_behavior` | `markdown_enter_continues_task_list_unchecked` |
| UC-3 | BR-11 | `markdown_authoring_behavior` | `markdown_enter_on_empty_list_item_exits_list` |
| UC-3 | BR-12 | `preview_rendering` | `code_block_background_has_stable_inset_block_geometry` |
| UC-4 | BR-13 | `theme_behavior` | `editor_revamp_preserves_icon_aligned_palette_roles` |
| UC-4 | BR-14 | `editor_polish_behavior` | `current_line_emphasis_stays_visible_without_becoming_dominant` |
| UC-5 | BR-17 | `lsp_completion` | `higher_scoring_prefix_match_ranks_first` |
| UC-5 | BR-18 | `editor_viewport_behavior` | `search_highlights_share_authoring_viewport_geometry` |
| UC-5 | BR-19 | `editor_behavior` | `paste_action_is_blocked_in_preview_mode_even_with_selection` |

## Location

| What | Location |
|------|----------|
| Top-level revamp contract | `docs/specs/editor-pane-revamp.md` |
| Design contract | `DESIGN.md` |
| Core editor behavior | `docs/specs/editor.md` |
| Soft Wrap behavior | `docs/specs/soft-wrap.md` |
| Editor Chrome polish | `docs/specs/editor-polish.md` |
| CompletionPopup polish | `docs/specs/editor-ide-polish.md` |
| Editor Pane state | `crates/tide-app/src/domain/pane/editor.rs` |
| Editor rendering | `crates/tide-app/src/domain/pane/editor_rendering.rs` |
| Cursor and overlay rendering | `crates/tide-app/src/adapter/outward/view/cursor.rs` |
| IME cursor areas | `crates/tide-app/src/adapter/outward/view/ime.rs` |
| Mouse and scroll input | `crates/tide-app/src/adapter/inward/` |
| Action routing | `crates/tide-app/src/application/services/action_service/mod.rs` |
