# Spec: Live Preview (LivePreviewMode)

## Overview
### As-Is
Current state: Two rendering modes — Plain (raw markdown with syntax highlighting) and Preview (read-only pulldown_cmark formatted). No hybrid mode. Switching between them is a full toggle.

### To-Be
Third rendering mode: LivePreviewMode. Renders from raw buffer but conditionally hides/shows markdown syntax based on cursor line position. Same coordinate space as raw buffer — no line folding.

### Approach
Three layers:
1. LivePreviewMap — maps buffer byte ranges to markdown elements, classifies syntax vs content bytes
2. Live preview rendering — new render path using LivePreviewMap
3. Block-level handling — code blocks, tables always show syntax with styling

## Bounded Contexts
- editor (domain/editor/) — LivePreviewMap, markdown parsing
- pane (domain/pane/) — EditorPane live_preview state, rendering
- input (domain/input/) — GlobalAction::ToggleLivePreview

## Use Cases

### UC-1: ToggleLivePreview
Actor: User
Trigger: Keybinding (GlobalAction::ToggleLivePreview)
Precondition: Focused pane is Editor with a markdown file (.md)
Flow:
1. User triggers toggle keybinding
2. If currently in plain mode, switch to LivePreviewMode
3. If currently in LivePreviewMode, switch to plain mode
4. If currently in full Preview mode, switch to LivePreviewMode (exit preview first)
Postcondition: Editor rendering mode changes; cursor and scroll position preserved
Business Rules:
- BR-1: LivePreviewMode is mutually exclusive with Preview mode
- BR-2: Toggle preserves cursor position and scroll offset
- BR-3: Only available for markdown files (.md extension)

### UC-2: InlineSyntaxHiding
Actor: System (automatic)
Trigger: Cursor moves to a different line
Precondition: LivePreviewMode is active
Flow:
1. When cursor leaves a line, inline syntax markers (**, *, _, `, [](), etc.) on that line are hidden
2. Content text is styled (bold, italic, underline, code background, etc.)
3. When cursor enters a line, all syntax markers on that line are revealed
4. Content shows raw markdown text with syntax highlighting
Postcondition: Lines without cursor show formatted preview; cursor line shows raw markdown
Business Rules:
- BR-1: Inline syntax hiding operates at the line level — all inline elements on a line share the same visibility
- BR-2: Syntax chars include: ** (bold), * (italic), _ (italic/bold), ` (inline code), []() (links), ![]() (images)
- BR-3: When syntax is hidden, content text shifts left to fill the space
- BR-4: Styled text uses MarkdownTheme colors (bold color, italic style, link underline, code background)

### UC-3: BlockElementStyling
Actor: System (automatic)
Trigger: LivePreviewMode rendering encounters block-level element
Precondition: LivePreviewMode is active
Flow:
1. Block-level elements (code blocks, tables, blockquotes, lists) always show their syntax markers
2. Background color and foreground styling are applied per MarkdownTheme
3. Code blocks show ``` fences and apply code background
4. Blockquotes show > prefix and apply quote styling
5. List markers (-, *, 1.) remain visible and styled
Postcondition: Block elements are visually distinct but always editable
Business Rules:
- BR-1: Block syntax markers are never hidden regardless of cursor position
- BR-2: Code block content gets syntax highlighting (if language specified) or code styling
- BR-3: Blockquote content gets quote foreground color
- BR-4: Heading # markers always visible, heading text styled (larger visual weight via color/bold)

### UC-4: LivePreviewMapConstruction
Actor: System (automatic)
Trigger: Buffer content changes (generation incremented)
Precondition: LivePreviewMode is active
Flow:
1. Parse buffer with pulldown_cmark offset_iter()
2. Collect source byte ranges for each markdown element
3. Classify bytes as syntax-marker or content for each element
4. Build sorted Vec of non-overlapping element ranges
5. Cache result with buffer generation for invalidation
Postcondition: LivePreviewMap is up-to-date with buffer content
Business Rules:
- BR-1: LivePreviewMap is cached and only rebuilt when buffer generation changes
- BR-2: Element ranges are non-overlapping and sorted by start offset
- BR-3: Nested formatting (bold inside italic) produces separate entries for outer and inner elements
- BR-4: Escaped markdown chars (\*, \**, etc.) are not treated as syntax markers

### UC-5: CursorColumnMapping
Actor: System (automatic)
Trigger: Rendering or click on a non-cursor line with hidden syntax
Precondition: LivePreviewMode is active, inline syntax is hidden on the target line
Flow:
1. For rendering: cursor on its own line uses raw buffer column (no mapping needed)
2. For click on non-cursor line: visual column must be mapped back to buffer column accounting for hidden syntax chars
3. After click, cursor moves to target line which then reveals syntax
Postcondition: Cursor position correctly maps between visual and buffer coordinates
Business Rules:
- BR-1: Cursor line never needs column remapping (all syntax visible)
- BR-2: Click on non-cursor line requires reverse mapping: visual_col → buffer_col
- BR-3: After cursor moves to clicked line, syntax is revealed and column mapping becomes identity

### UC-6: SoftWrapInteraction
Actor: System (automatic)
Trigger: LivePreviewMode with soft wrap enabled
Precondition: Both LivePreviewMode and soft wrap are active
Flow:
1. WrapMap is built from raw buffer line widths (not display widths)
2. Visual lines may be shorter than wrap width on non-cursor lines (due to hidden syntax)
3. This is acceptable for v1 — no display-width-aware wrapping
Postcondition: Soft wrap works but may produce slightly shorter visual lines
Business Rules:
- BR-1: WrapMap uses raw buffer widths for v1 (no special live preview awareness)
- BR-2: No correctness issues — only visual suboptimality on non-cursor lines

## Invariants
1. Line count in LivePreviewMode equals raw buffer line count (no line folding)
2. Cursor position is always in raw buffer coordinates
3. LivePreviewMode is mutually exclusive with full Preview mode
4. LivePreviewMap generation matches buffer generation when valid

## Tests
| UC | BR | Test Function |
|----|-----|--------------|
| UC-1 | BR-1 | toggle_live_preview_exits_full_preview() |
| UC-1 | BR-2 | toggle_live_preview_preserves_cursor_and_scroll() |
| UC-1 | BR-3 | toggle_live_preview_only_for_markdown_files() |
| UC-2 | BR-1 | inline_syntax_hidden_on_non_cursor_lines() |
| UC-2 | BR-2 | all_inline_syntax_types_detected() |
| UC-2 | BR-3 | content_shifts_left_when_syntax_hidden() |
| UC-2 | BR-4 | styled_text_uses_markdown_theme() |
| UC-3 | BR-1 | block_syntax_never_hidden() |
| UC-3 | BR-2 | code_block_content_styled() |
| UC-3 | BR-3 | blockquote_content_styled() |
| UC-3 | BR-4 | heading_markers_visible_and_styled() |
| UC-4 | BR-1 | live_preview_map_cached_by_generation() |
| UC-4 | BR-2 | element_ranges_sorted_non_overlapping() |
| UC-4 | BR-3 | nested_formatting_produces_separate_entries() |
| UC-4 | BR-4 | escaped_chars_not_treated_as_syntax() |
| UC-5 | BR-1 | cursor_line_no_column_remap() |
| UC-5 | BR-2 | click_non_cursor_line_maps_visual_to_buffer() |
| UC-6 | BR-1 | soft_wrap_uses_raw_widths() |

## Location
- LivePreviewMap: `crates/tide-app/src/domain/editor/markdown.rs`
- EditorPane live preview state: `crates/tide-app/src/domain/pane/editor.rs`
- Live preview rendering: `crates/tide-app/src/domain/pane/editor_rendering.rs`
- GlobalAction: `crates/tide-app/src/domain/input/`
- Behavior tests: `crates/tide-app/src/application/behavior_tests/`
