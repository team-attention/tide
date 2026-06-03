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

Out of scope: true inline (cursor-aware) live-preview WYSIWYG — no robust MIT
CM6 library exists, so a preview/edit toggle is used instead (per product call).

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

## Invariants

1. Markdown Preview never executes raw HTML from file content.
2. The Editor Pane shows no file-info (Path/Size/Revision) panel and no LSP/save
   action buttons (LSP is right-click; save is Cmd/Ctrl+S).
3. Code panes keep working LSP navigation.

## Tests

| Rule | Test |
|------|------|
| UC-1 markdown renders Preview by default | `markdown_editor_pane_renders_preview_with_rendered_headings` |
| UC-1 no raw `#` in preview | same (asserts rendered `<h1>`/`<h2>`, not literal `## `) |
| UC-2 toggle shows source editor | `markdown_editor_pane_toggle_shows_source_editor` (jsdom) |
| UC-3 code file shows code editor not preview | `code_editor_pane_has_no_markdown_preview_toggle` |
| D1 raw HTML escaped | `markdown_preview_escapes_raw_html` |

## Location

- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts`
- `src/desktop/renderer/tide-product-shell.css`
