# Spec: Desktop Workbench Pane Content Rendering

## Scope

This spec makes the Product Shell render useful content for visible Workbench
Panes that are already produced by Backend contracts.

It covers:

- Browser Pane metadata and bounded text preview.
- Editor Pane path metadata and bounded file preview.
- Diff Pane path metadata and bounded diff text.
- Terminal Pane command/status/transcript metadata, including Provider Setup
  Surface input when the Terminal Pane is running.

It does not implement a native browser WebView, full text editing, full diff
interaction, full terminal emulation, or FileTree contents.

## Evidence

- `docs_v2/master-plan.md` says Workbench can contain Browser, Diff, Editor, or
  Terminal Panes for inspection, editing, verification, and direct work.
- `docs_v2/implementation/concrete-design-backlog.md` lists Workbench and Tide
  MCP tools as a core path from Agent Runtime to visible Workbench UI.
- `docs_v2/specs/tide-mcp-workbench-observe-open-browser.md` defines Browser
  Pane refs with stable ids, revisions, URL, title, loading state, and bounded
  preview data.
- `docs_v2/specs/tide-mcp-file-workbench-tools.md` defines visible Editor Pane
  refs with file path, relative path, bounded text preview, byte length, and
  truncation metadata.
- `docs_v2/specs/tide-mcp-file-edit-diff-tools.md` defines visible Diff Pane
  refs with bounded diff text and before/after byte lengths.
- `docs_v2/specs/tide-mcp-terminal-command-tool.md` defines visible Terminal
  Pane evidence for command output.
- `docs_v2/specs/provider-setup-surface-input-and-retry.md` defines the running
  Provider Setup Surface Terminal Pane input path.
- `src/shared/contracts/workbench.ts` already carries the fields this Desktop
  slice must render.

## Decisions

### D1. Desktop renders bounded previews from Shared Contracts

Desktop does not read files, run commands, or inspect browser state directly.
It renders the bounded `WorkbenchPaneRefDto` data delivered by Backend events.

### D2. Generic placeholder is not enough for known Pane kinds

Known Workbench Pane kinds must have kind-specific content. A placeholder may
remain only for unknown future data, not for Browser, Editor, Diff, or Terminal.

### D3. Preview rendering stays bounded and passive

Editor, Diff, Browser, and Terminal content is read-only in this slice except
for the already-specified running Provider Setup Surface terminal input.

## Contracts

No Shared Contract shape changes are required. Desktop must preserve the
existing optional fields from `WorkbenchPaneRefDto` into its Workbench view
model:

- Browser: `url`, `pageTitle`, `loading`, `bodyTextPreview`.
- Editor: `filePath`, `relativePath`, `bodyTextPreview`, `byteLength`,
  `truncated`.
- Diff: `filePath`, `relativePath`, `diffText`, `beforeByteLength`,
  `afterByteLength`, `truncated`.
- Terminal: `command`, `args`, `cwd`, `status`, `expectedCompletion`,
  `transcriptPreview`, `exitCode`, `signal`, `timedOut`.

## Flow

### UC-1: Render Browser Pane

1. Backend emits `workbench.changed` with an active Browser Pane.
2. Desktop preserves Browser metadata in App Chrome state.
3. Product Shell renders URL, page title or title, loading state, and bounded
   body preview.

### UC-2: Render Editor Pane

1. Backend emits `workbench.changed` with an active Editor Pane.
2. Desktop preserves path and preview metadata.
3. Product Shell renders the relative path, byte length, truncation state, and
   bounded text preview.

### UC-3: Render Diff Pane

1. Backend emits `workbench.changed` with an active Diff Pane.
2. Desktop preserves diff metadata.
3. Product Shell renders the relative path, before/after byte counts, truncation
   state, and bounded diff text.

### UC-4: Render Terminal Pane

1. Backend emits `workbench.changed` with an active Terminal Pane.
2. Desktop preserves command/status/transcript metadata.
3. Product Shell renders command evidence and transcript preview.
4. If the Terminal Pane is running, Product Shell exposes raw-byte setup input.

## Invariants

1. Desktop Workbench content rendering never mutates Backend state by itself.
2. Desktop does not fabricate Pane content when Backend omits it.
3. Browser, Editor, Diff, and Terminal content is derived from the active
   Workbench Pane ref.
4. Known Pane kinds do not render the generic placeholder.
5. Terminal input is available only for running Terminal Panes.

## Tests

| Rule | Test expectation |
|------|------------------|
| Browser content renders | `workbench_browser_pane_renders_url_loading_and_preview` proves Product Shell renders Browser metadata from `workbench.changed`. |
| Editor content renders | `workbench_editor_pane_renders_path_size_and_preview` proves Product Shell renders Editor metadata without a placeholder. |
| Diff content renders | `workbench_diff_pane_renders_diff_metadata_and_text` proves Product Shell renders Diff metadata and bounded diff text. |
| Terminal evidence renders | `provider_setup_terminal_pane_renders_preview_and_input_controls` continues to prove Terminal metadata and input controls render for running setup Panes. |

## Implementation Notes

- Keep Workbench content components in the Product Shell renderer adapter.
- Keep view-model field preservation in App Chrome state.
- Use existing Product Shell palette and mono font rules for preview blocks.
