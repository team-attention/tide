# Spec: HTML Preview / Code toggle in the Workbench

## Scope
HTML files (`.html` / `.htm`) open in the Workbench editor as a **rendered preview**
(the page in a `<webview>`, like a browser) by default, with a **Preview / Code**
toggle to switch to the raw source editor and back — mirroring markdown's Preview/Edit.

## Evidence
- `WorkbenchEditorPane` infers a language from the path and routes markdown →
  `WorkbenchMarkdownView` (Preview/Edit toggle, default Preview), everything else →
  `WorkbenchCodeEditor`. HTML currently falls to the plain code editor.
- `WorkbenchMarkdownView` is the toggle template: `mode: "preview" | "edit"`, default
  preview, breadcrumb rides in the view header next to the toggle.
- The Browser Pane renders an Electron `<webview>` (`partition`, `src`).
- Editor panes carry an absolute `filePath` — both backend (thread) panes and the
  synthetic start-page pane (view-model sets `filePath = cwd + "/" + relativePath`),
  so a `file://` preview works for both.

## Decisions
- Default = **Preview** (user: "기본 값은 전자고").
- Preview renders the **saved file** via `file://<filePath>` so relative assets
  (CSS/JS/images) resolve — the faithful "browser view". Editing happens in Code; after
  a save, toggling back to Preview reloads it (the webview is conditionally rendered, so
  it remounts on toggle).
- Scope to `.html`/`.htm` only (the request). SVG/XML stay code-only for now.
- If no `filePath` is resolvable, fall back to Code only (no preview toggle).

## Out Of Scope
- Live-buffer preview of unsaved edits (preview = saved file).
- A preview for other renderable types.

## Flow
1. `inferEditorLanguage` returns `"html"` → `WorkbenchEditorPane` renders
   `WorkbenchHtmlView` (instead of the code editor), passing value/readOnly/dirty/
   revision/filePath/relativePath/breadcrumb/handlers.
2. `WorkbenchHtmlView`: header (breadcrumb + Preview/Code toggle); Preview → a
   `<webview src=file://filePath>`; Code → `WorkbenchCodeEditor` (language html).

## Invariants
- Default mode is Preview when a file path is resolvable.
- Code mode is the unchanged editor (save/dirty/breadcrumb identical to other files).
- Markdown and all non-HTML routing are unchanged.

## Tests
- `WorkbenchEditorPane` renders the HTML view (webview + Preview/Code toggle) for an
  `.html` pane, defaulting to a rendered preview, not the bare code editor; non-HTML
  unchanged. (renderToStaticMarkup) Live: open an .html file → rendered → toggle Code →
  source → toggle Preview → rendered.
