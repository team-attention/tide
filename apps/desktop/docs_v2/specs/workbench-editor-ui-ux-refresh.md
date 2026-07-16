# Spec: Workbench Editor UI/UX Refresh

## Scope

Improve the Workbench Editor as one continuous reading and editing surface.

This initiative covers three coordinated changes:

1. Replace the fixed dark Editor skin with theme-aware semantic surfaces.
2. Replace the Markdown read-only Preview / raw Edit split with editable
   `Live Preview` and editable `Source` presentations over one document.
3. Rebalance code and Markdown typography so long reading and editing sessions
   feel compact, calm, and consistent with the Tide design system.

The work is Desktop-owned. It does not change Backend file ownership, Editor
Pane contracts, revision checks, save commands, or Agent editing capabilities.

This spec supersedes:

- `workbench-editor-pane-editing.md` D8, which fixes the Editor to a dark code
  surface independent of the app theme.
- `workbench-markdown-preview-editor.md` D2 and its read-only Preview flow.
- The preview-only typography decisions in
  `workbench-markdown-preview-editor.md` where this spec defines new shared
  Editor typography.

## Evidence

- `DESIGN.md` defines a paper-like light surface, a low-glare dark surface,
  restrained semantic color, and compact desktop typography.
- `code-editor.styles.ts` currently hard-codes dark Editor, chrome, gutter,
  text, selection, and cursor colors instead of consuming app theme tokens.
- The current code editor uses `Roboto Mono` at `12.5px/1.62`, while the design
  system defines code at `12px/1.55`.
- `code-editor.tsx` already mounts CodeMirror 6, uses incremental language
  parsers, preserves draft state, and shares save and selection handlers.
- `editor-pane.tsx` already maps Markdown files to
  `@codemirror/lang-markdown`.
- The installed Markdown parser exposes stable syntax nodes for headings,
  emphasis, strikethrough, inline code, links, blockquotes, lists, tables, and
  fenced code.
- `markdown-view.tsx` currently swaps between a `markdown-it` HTML subtree and a
  separate CodeMirror subtree. That transition changes the interaction model
  and cannot preserve one Editor view, selection, undo history, and scroll
  anchor by construction.
- Existing CodeMirror selection and Add to Chat behavior can serve both code
  and Markdown without a preview-specific DOM selection implementation.

## Decisions

### D1. The Editor follows the app theme

The Workbench Editor uses semantic tokens derived from the active Tide theme.
It does not keep an independently fixed dark surface.

Required roles:

- Editor content background: app content background.
- Editor chrome and gutter: the nearest quiet Workbench surface.
- Primary and muted text: app text roles.
- Selection and focus: the existing precision accent roles.
- Active line: a low-contrast neutral or accent tint that does not read as a
  warning band.
- Syntax, diagnostics, diff marks, and links: semantic Editor roles with
  readable light and dark values.

Changing the app theme updates an open Editor without remounting it or losing
Editor state.

### D2. Code typography uses the design-system mono rhythm

Code and raw Markdown source use the mono stack defined by `DESIGN.md`:

- Font size: `12px` by default.
- Line height: `1.55`.
- Letter spacing: normal; do not compensate for font metrics with a custom
  tracking value.
- Ligatures: contextual only.
- Line numbers and metadata remain smaller and quieter than code.

User-configurable Editor font settings are a later concern. This slice defines
one coherent default.

### D3. Markdown Live Preview uses prose typography inside CodeMirror

Markdown Live Preview remains a CodeMirror document but renders prose with a
reading-oriented type hierarchy:

- Body: Inter with system fallbacks, `15px/22px`.
- H1: `25px/32px`, weight `650`.
- H2: `20px/28px`, weight `650`.
- H3: `16px/24px`, weight `600`.
- H4-H6: compact steps at or near body size with weight and muted color carrying
  the hierarchy.
- Inline code and fenced code: the Editor mono stack at `12px/1.55`.
- Reading measure: target `65-75ch` when Pane width permits; narrow Panes use
  the available width without horizontal page overflow.

The hierarchy uses scale, weight, spacing, and restrained contrast. Headings do
not need persistent borders to be recognizable.

### D4. Markdown has Live Preview and Source presentations

The Markdown mode control remains visible and is labeled `Live Preview` and
`Source`.

Both presentations are editable:

- `Live Preview` is the default.
- `Source` always displays every Markdown syntax character.
- Both operate on the same CodeMirror document, draft, selection model, undo
  history, dirty state, save command, and external-change state.
- Switching presentations reconfigures CodeMirror extensions; it does not swap
  to a separately parsed HTML subtree.
- The control uses tabs or a pressed-state segmented control with an accessible
  group label and unambiguous selected state.

### D5. Live Preview hides syntax without changing source

Live Preview uses CodeMirror decorations over the Markdown syntax tree.
Supported syntax characters remain in the document and are only visually
replaced while inactive.

Initial marker coverage:

- Heading markers and their separating space.
- Emphasis, strong, and strikethrough markers.
- Inline-code backticks.
- Link brackets, destination punctuation, and URL.
- Blockquote markers.
- List markers and task-list brackets where a visual list or checkbox is shown.
- Table delimiters and separator rows.
- Opening and closing fenced-code markers.

Marker reveal rules:

1. Source presentation always shows all markers.
2. Live Preview hides supported markers outside the active construct.
3. A caret or selection inside an inline construct reveals the full construct's
   editable syntax.
4. A caret or selection on a block construct reveals the markers needed to edit
   that block.
5. Losing Editor focus returns inactive constructs to their rendered state.
6. Unsupported or ambiguous syntax stays visible rather than risking a false
   preview.

No Markdown serializer is introduced. Saving writes the CodeMirror document
string, preserving the original source outside the user's edits.

### D6. Live Preview decorates Markdown blocks in place

The first complete release supports:

- Heading type scale and vertical rhythm.
- Emphasis, strong, strikethrough, inline code, and links.
- Ordered, unordered, and task lists.
- Blockquotes with a quiet neutral rail.
- Horizontal rules.
- Fenced code with contained background, language label, syntax highlighting,
  and local horizontal overflow when wrapping is disabled.
- GFM tables with contained horizontal overflow, readable header hierarchy,
  row separators, and source markers revealed for the active row.
- Images with a bounded preview associated with the source line; broken,
  remote-blocked, or unsupported images keep visible source and a non-blocking
  fallback state.

Live Preview does not execute raw HTML. Raw HTML remains visible source in the
Editor.

### D7. Presentation changes preserve work state

Switching `Live Preview` / `Source` must preserve:

- CodeMirror Editor instance and document.
- Selection and caret logical position.
- Undo and redo history.
- Dirty, saving, conflict, and read-only state.
- In-pane find query and active match when the match remains valid.
- Add to Chat selection behavior.
- A logical top-line anchor. Exact pixel scroll is not required when typography
  reflows, but the user must remain at the same document location.

The transition uses no decorative animation. A short color or opacity
transition may be used only if it does not delay editing and respects reduced
motion.

### D8. Decoration work is incremental and viewport-bounded

The Live Preview extension:

- Traverses visible CodeMirror ranges plus a small overscan, not the full
  document on every cursor move.
- Rebuilds decorations only for document, selection, focus, viewport, parser,
  or presentation changes that can affect them.
- Uses the incremental Lezer syntax tree already owned by CodeMirror.
- Does not parse the Markdown document again through `markdown-it` for the
  Editor surface.
- Keeps large-file and truncated-file read-only behavior unchanged.

### D9. Accessibility and input behavior are release criteria

- Live Preview and Source expose an accessible mode name and selected state.
- Hidden syntax is revealed through focus and selection, never hover alone.
- Keyboard navigation, Korean IME composition, copy, paste, undo, redo, and
  screen-reader text must operate on the real Markdown source.
- Important states remain distinguishable without color alone.
- Read-only Markdown supports both presentations but never becomes editable.
- Reduced-motion preferences disable nonessential transitions.

## Out Of Scope

- Changing Agent Chat Markdown rendering.
- A general-purpose WYSIWYG or rich-text document model.
- Reformatting or serializing Markdown after edits.
- Collaborative multi-cursor editing.
- User-selectable font family, font size, or line-height settings.
- Inline execution of raw HTML, scripts, or remote embeds.
- Replacing the existing Backend save, revision, or conflict contracts.
- Extending Live Preview behavior to HTML, MDX components, or non-Markdown
  files in this initiative.

## Domain Model

The presentation mode is Desktop-local UI state and does not cross Shared
Contracts.

```ts
type MarkdownEditorPresentation = "live-preview" | "source";

interface MarkdownEditorViewState {
  presentation: MarkdownEditorPresentation;
  logicalScrollAnchor?: {
    line: number;
    offset: number;
  };
}
```

The existing Editor draft remains the only editable file content model.

## Contracts

No Backend or Shared Contract changes are required.

Desktop keeps using:

- Editor Pane file identity and revision.
- Local Editor draft state.
- `workbench.command save_editor_file`.
- Existing stale-revision and truncated-file behavior.

## Flow

### UC-1: Open a code file in the active theme

1. The user opens a code file.
2. The Editor mounts with semantic theme tokens and the default mono metrics.
3. App theme changes update colors without remounting the Editor.
4. Selection, cursor, undo history, and scroll position remain intact.

### UC-2: Read and edit Markdown in Live Preview

1. The user opens a Markdown file.
2. The Editor opens in `Live Preview` and remains editable.
3. Inactive heading and inline-format markers are hidden by decorations.
4. The user places the caret in a formatted construct.
5. The relevant syntax markers become visible.
6. The user edits the source directly; the rendered presentation updates from
   the same incremental syntax tree.
7. The draft becomes dirty and saves through the existing command.

### UC-3: Inspect and edit complete Markdown source

1. The user activates `Source`.
2. The current CodeMirror document remains mounted.
3. All syntax markers appear and source typography becomes mono.
4. Selection, undo history, dirty state, and logical scroll location remain.
5. The user can edit and save without returning to Live Preview.

### UC-4: Return to Live Preview

1. The user activates `Live Preview`.
2. Live Preview decorations and prose typography are re-enabled.
3. The user stays at the same logical document position.
4. Unsupported constructs remain visible source.

### UC-5: Open read-only Markdown

1. The user opens a truncated or otherwise read-only Markdown Pane.
2. Live Preview renders without an editable caret.
3. Source remains available for inspection.
4. Neither presentation exposes a save action or mutates the draft.

## Invariants

1. The app theme is the authority for Editor light and dark surfaces.
2. Markdown Live Preview and Source share one source document and one undo
   history.
3. Live Preview never removes or rewrites Markdown syntax in the document.
4. Switching presentation never changes file content or dirty state by itself.
5. Raw HTML is never executed by the Editor.
6. Backend remains the only file-writing boundary.
7. Existing stale revision, conflict, and truncated-file rules remain intact.
8. Unsupported Markdown remains safely editable as visible source.
9. Editor rendering remains responsive on documents within the existing size
   limit.

## Tests

### Theme and typography

| Rule | Test |
|------|------|
| Editor consumes semantic theme roles | `workbench_editor_uses_theme_aware_surface_tokens` |
| Theme change preserves Editor state | `workbench_editor_theme_change_preserves_selection_and_history` |
| Code uses default mono metrics | `workbench_editor_uses_compact_mono_typography` |
| Live Preview uses prose hierarchy | `markdown_live_preview_uses_prose_typography_and_mono_code` |
| Editor does not set custom letter spacing | `workbench_editor_keeps_normal_text_tracking` |

### Live Preview behavior

| Rule | Test |
|------|------|
| Markdown opens in editable Live Preview | `markdown_editor_opens_in_editable_live_preview` |
| Inactive heading marker is hidden | `markdown_live_preview_hides_inactive_heading_marker` |
| Active heading marker is revealed | `markdown_live_preview_reveals_active_heading_marker` |
| Inline markers follow active selection | `markdown_live_preview_reveals_active_inline_syntax` |
| Source shows every marker | `markdown_source_presentation_shows_all_syntax` |
| Toggle keeps one document and history | `markdown_presentation_toggle_preserves_document_selection_and_undo` |
| Toggle keeps logical scroll location | `markdown_presentation_toggle_preserves_logical_scroll_anchor` |
| Editing either presentation marks dirty | `markdown_both_presentations_share_editor_draft` |
| Cmd/Ctrl+S saves either presentation | `markdown_both_presentations_share_save_command` |

### GFM, safety, and performance

| Rule | Test |
|------|------|
| Lists, quotes, rules, and fences decorate in place | `markdown_live_preview_decorates_common_blocks` |
| Tables remain contained | `markdown_live_preview_contains_wide_gfm_table` |
| Images are bounded with safe fallback | `markdown_live_preview_bounds_images_and_keeps_broken_source_visible` |
| Raw HTML is visible and not executed | `markdown_live_preview_does_not_execute_raw_html` |
| Decoration pass is viewport-bounded | `markdown_live_preview_decorates_visible_ranges_only` |
| Read-only state applies to both presentations | `markdown_read_only_state_applies_to_live_preview_and_source` |
| IME composition does not toggle markers mid-composition | `markdown_live_preview_preserves_ime_composition` |

## Implementation Plan

### Slice 1: Theme and code typography foundation

1. Replace fixed Editor color constants with semantic Editor roles sourced from
   the active app theme.
2. Add light and dark syntax values with restrained contrast.
3. Align code font size and line height with `DESIGN.md`.
4. Update the existing visual-foundation test that currently requires a fixed
   dark surface.
5. Verify code navigation, selection, Git line decorations, find, save, and
   read-only behavior are unchanged.

Completion gate: code files are visually coherent in both themes, and a theme
change does not remount or reset the Editor.

### Slice 2: Single Markdown Editor and presentation control

1. Route Markdown through the existing Workbench CodeMirror component.
2. Replace `Preview / Edit` with `Live Preview / Source`.
3. Store presentation as Desktop-local view state.
4. Use CodeMirror compartments to reconfigure presentation extensions and
   typography without replacing the Editor instance.
5. Preserve selection, undo, dirty state, save behavior, Add to Chat, find, and
   logical scroll anchor.

Completion gate: both presentations are editable and switching between them
does not change content or work state.

### Slice 3: Live Preview markers and core block styling

1. Add a `markdown-live-preview.ts` CodeMirror ViewPlugin.
2. Build viewport-bounded replacement and line decorations from the Lezer
   Markdown syntax tree.
3. Implement marker reveal rules for headings, emphasis, code, links, lists,
   blockquotes, and fenced code.
4. Add prose heading/body styling, inline code, quote rail, horizontal rule,
   list rhythm, and fenced-code surfaces.
5. Keep unsupported syntax visible.

Completion gate: the user can read and edit common Markdown without leaving
Live Preview, and the saved source remains exact.

### Slice 4: GFM parity, hardening, and visual verification

1. Add task-list, table, and image presentation behavior.
2. Cover raw HTML, incomplete syntax, empty documents, very long lines, nested
   lists, large tables, broken images, and read-only files.
3. Verify keyboard, pointer, Korean IME, screen-reader naming, zoom, focus,
   reduced motion, and theme switching.
4. Run component tests, typecheck, a packaged-app smoke check, and visual checks
   in light and dark themes at narrow and wide Pane sizes.
5. Remove Editor-only `markdown-it` preview code after parity tests pass; keep
   shared Markdown rendering used by Agent Chat outside this initiative.

Completion gate: Live Preview matches the current Markdown feature set without
source-fidelity, accessibility, or performance regressions.

## Implementation Notes

Expected Desktop file responsibilities:

- `workbench/markdown-live-preview.ts`: syntax-tree traversal, marker reveal
  policy, and CodeMirror decorations only.
- `workbench/markdown-live-preview.styles.ts`: Live Preview CodeMirror theme and
  prose/code metrics only, if keeping the theme separate improves ownership.
- `workbench/code-editor.tsx`: shared Editor lifecycle and presentation
  compartments; no Markdown syntax policy.
- `workbench/code-editor.styles.ts`: semantic Editor chrome, gutter, code
  typography, and shared CodeMirror surfaces.
- `workbench/markdown-view.tsx`: thin Markdown Pane chrome and presentation
  control, or removal if the control is cleanly owned by `editor-pane.tsx`.
- `workbench/editor-pane.tsx`: file-kind routing only.
- `tests/workbench-code-editor.test.tsx`: CodeMirror behavior, presentation
  reconfiguration, selection, history, IME, and save behavior.
- `tests/desktop-product-shell-visual-foundation.test.tsx`: semantic theme and
  rendered structure expectations.

Do not put parser traversal, file saving, and React Pane chrome into the same
module. The Live Preview extension is a Desktop renderer concern and requires
no new Shared Contract or Backend abstraction.

## Open Questions

1. Should the Markdown presentation choice persist globally, per Project, or
   per file? Default for the first slice: session-local per Pane.
2. Should fenced code wrap by default in Live Preview? Default for the first
   slice: wrap prose, preserve horizontal scrolling for code.
3. Should heading markers reveal when the caret is anywhere in the heading or
   only near the marker? Default for the first slice: anywhere in the active
   heading, because it makes editability easier to discover.
