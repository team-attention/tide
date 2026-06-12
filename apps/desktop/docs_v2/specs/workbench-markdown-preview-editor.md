# Spec: Workbench Markdown Preview/Edit + Polished Editor

## Scope

The Workbench Editor Pane must render files well, not as a cramped raw textarea:

- Markdown files (`.md`, `.markdown`) render as a pretty, Obsidian-style reading
  **Preview** by default, and can be toggled to **Edit** (raw source) and saved.
- Non-markdown (code) files render as a real code editor (CodeMirror source,
  syntax highlighting, line numbers, TS/JS LSP go-to-definition / find-references
  on right-click, Cmd/Ctrl+S save).
- Both share a breadcrumb path bar matching the canonical Figma editor
  (`tide › CLAUDE.md`, Inter Medium 13px, 32px left padding) and the Figma
  reading-view typography for rendered markdown (title 25px bold #29252d, body
  15px/22 #242424, Inter).

The Editor Pane Preview (`.markdown-body`) renders **conventional GFM**, clean
and intuitive, with no per-feature makeshift workarounds: headings `h1`–`h6`,
lists, **tables**, **task lists** (`- [ ]` / `- [x]` checkboxes), strikethrough,
images, links, blockquotes, horizontal rules, and **syntax-highlighted fenced
code**. Wide tables and long lines stay inside the reading column (horizontal
scroll within the element), never clip on the right or force a page-wide
scrollbar.

Out of scope: the Agent Chat answer body (`.agent-session-turn__body--md`) —
that is a separate live-streaming surface owned by the agent-session rendering
path and is intentionally left untouched here.
Out of scope: true inline (cursor-aware) live-preview WYSIWYG — no robust MIT
CM6 library exists, so a preview/edit toggle is used instead (per product call).
Out of scope: a new syntax-highlighter dependency — the bundled CodeMirror/Lezer
highlighter (`highlightToHtml`) is reused for fenced code.

## Evidence

- Figma frame 1223:2 / Workbench Pane Body 1331:54: the editor renders CLAUDE.md
  as a clean Inter-typeset reading view (breadcrumb `tide › CLAUDE.md` 13px
  #8a8781; title "Tide — Project Rules" Inter Bold 25px #29252d; body Inter
  Regular 15px/22 #242424; 32px left padding), markdown rendered (no `#`).
- `typescript-code-intelligence-port.ts` provides real LSP (ts language service)
  for TS/JS; markdown has no LSP.
- `inferEditorLanguage` currently maps `.md` to `text`, so markdown rendered as
  unhighlighted plain source — the current poor behavior.
- Libraries: `markdown-it` (MIT) for rendering; `@codemirror/lang-markdown` (MIT)
  for source highlighting in Edit mode.

## Decisions

- D1. Markdown rendering uses `markdown-it` with `html: false` (raw HTML in the
  file is escaped, not executed) so rendering local/agent files is safe.
- D2. Markdown pane defaults to Preview; an Edit/Preview toggle switches modes.
  Edit mode is the source CodeMirror (markdown highlighting), and saves on
  Cmd/Ctrl+S. Switching back to Preview re-renders the current draft/content.
- D3. Code (non-markdown) panes have no toggle; they are the code editor + LSP.
- D4. Preview typography conforms to the Figma reading view.
- D5. GFM scope is the full set (tables, task lists, strikethrough, images,
  `h1`–`h6`, fenced-code highlighting). Tables and strikethrough are already
  on in markdown-it's default preset; task lists are added by a small
  dependency-free plugin (`taskListPlugin`); images and `h4`–`h6` are native and
  need only CSS.
- D6. Fenced code is highlighted by the bundled `highlightToHtml`
  (CodeMirror/Lezer), not a new highlighter dependency — unsupported languages
  fall back to a styled plain code block. (Per [v2 performance budget].)
- D7. Wide tables scroll horizontally **inside their own block**
  (`display:block; width:max-content; max-width:100%; overflow-x:auto`) so they
  never clip on the right or widen the reading column. One rule replaces ad-hoc
  per-table width hacks.
- D8. Preview rendering is **memoized** by source string (`renderMarkdownCached`,
  bounded per-instance LRU) in a `useMemo`, so re-renders triggered by unrelated
  state changes don't re-parse the whole file. Only an actual content change
  (edited draft) re-parses.

## Use Cases

### UC-1: Open a markdown file
Actor opens a `.md` Editor Pane → it shows the rendered Preview by default
(headings rendered, no raw `#`), styled like the Figma reading view.

### UC-2: Edit a markdown file
Actor toggles to Edit → source CodeMirror appears with the raw markdown; edits
mark the draft dirty; Cmd/Ctrl+S saves; toggling to Preview shows the edited
content rendered.

### UC-3: Open a code file
Actor opens a `.ts`/`.rs`/etc. Editor Pane → code editor (source + syntax +
line numbers), right-click offers Go to Definition / Find References, Cmd+S saves.
No Preview toggle.

### UC-4: Render GFM in the Preview
A `.md` Preview renders a table (with header/cells), task-list checkboxes for
`- [ ]`/`- [x]` items, strikethrough, `h4`–`h6`, images, and syntax-highlighted
fenced code — not raw `|`/`[ ]`/`~~` source.

### UC-5: Wide table stays in the column
A markdown table wider than the content column scrolls horizontally within its
own block; it does not clip on the right edge or widen the page.

## Invariants

1. Markdown Preview never executes raw HTML from file content. (Task-list
   checkboxes are emitted by Tide's own plugin, not from file content, and are
   `disabled` read-only inputs.)
2. The Editor Pane shows no file-info (Path/Size/Revision) panel and no LSP/save
   action buttons (LSP is right-click; save is Cmd/Ctrl+S).
3. Code panes keep working LSP navigation.
4. The Editor Preview renders the GFM full set (tables, task lists,
   strikethrough, images, `h1`–`h6`, highlighted fenced code).
5. A wide table never produces a page-wide horizontal scrollbar nor clips on the
   right; overflow is contained in the table block.
6. Repeated rendering of the same source returns cached HTML (no re-parse).

## Tests

| Rule | Test |
|------|------|
| UC-1 markdown renders Preview by default | `markdown_editor_pane_renders_preview_with_rendered_headings` |
| UC-1 no raw `#` in preview | same (asserts rendered `<h1>`/`<h2>`, not literal `## `) |
| UC-2 toggle shows source editor | `markdown_editor_pane_toggle_shows_source_editor` (jsdom) |
| UC-3 code file shows code editor not preview | `code_editor_pane_has_no_markdown_preview_toggle` |
| D1 raw HTML escaped | `markdown_preview_escapes_raw_html` |
| UC-4 table renders | `markdown_editor_pane_renders_gfm_table` |
| UC-4 task list renders checkbox | `markdown_editor_pane_renders_task_list_checkboxes` |
| UC-4 fenced code highlighted | `markdown_editor_pane_highlights_fenced_code` |
| D8 memoized render | `markdown_rendering_is_memoized_by_source` |
| Invariant 1 checkboxes are disabled read-only | `markdown_task_list_checkboxes_are_disabled` |

## Implementation Notes

- `react-renderer/markdown-rendering.ts`: `taskListPlugin(md)` (dependency-free
  GFM checkboxes; injects `disabled` `html_inline` checkbox tokens, safe under
  `html:false`) and `renderMarkdownCached(md, source)` (bounded per-`md` LRU).
- Editor `markdownRenderer`: `.use(taskListPlugin)`, a `fence` rule that uses
  `highlightToHtml`, rendered through `renderMarkdownCached` in `useMemo`.
- Table overflow (D7) and task-list/`h4`–`h6`/image/strikethrough styling are
  CSS on `.markdown-body` only.
- Scope is the Editor Pane Preview only; the Agent Chat answer body is a separate
  surface and is intentionally not changed by this spec.

## Location

- `src/desktop/adapters/inbound/react-renderer/markdown-rendering.ts` (new)
- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts`
- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.css`
