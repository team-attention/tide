# Spec: Workbench Editor Pane Editing

## Scope

This spec turns a visible Workbench Editor Pane from a passive file preview into
a human-editable file surface for the active Thread.

It covers:

- Opening an Editor Pane with full editable text when the file is inside the
  active Thread Execution Context and is within the bounded editor size.
- Keeping truncated Editor Panes read-only.
- Editing the Editor Pane draft in Desktop without Desktop filesystem access.
- Saving the Editor Pane through Backend `workbench.command save_editor_file`.
- Rejecting saves when the Editor Pane revision is stale.
- Refreshing the saved Editor Pane and preserving Workbench focus.

It does not cover:

- Agent arbitrary file overwrite tools.
- Multi-file patch application.
- LSP, symbols, go-to-reference, rename, or diagnostics UI.
- Full CodeMirror or Monaco integration.

LSP and go-to-reference require this slice first because they need a real
Editor Pane text model, stable file identity, and a save path.

## Evidence

- `docs_v2/master-plan.md` says the Workbench can contain Editor Panes for
  editing and direct work beside the Agent Chat.
- `docs_v2/glossary.md` defines Workbench Pane, Editor Pane, Execution Context,
  Backend, Desktop, Shared Contracts, and Tide MCP Tool Surface.
- `docs_v2/specs/desktop-workbench-pane-content-rendering.md` explicitly keeps
  Editor content read-only and excludes full text editing.
- `docs_v2/specs/tide-mcp-file-workbench-tools.md` defines `tide_open_file` as
  the tool that creates or reveals a visible Editor Pane, but excludes writing.
- `docs_v2/specs/tide-mcp-file-edit-diff-tools.md` intentionally keeps Agent
  file editing to exact replacement through `tide_edit_file`, so human Editor
  Pane save needs a separate Workbench command path.
- `src/shared/contracts/commands.ts` already has generic `workbench.command`
  payloads for Thread-scoped Workbench actions.
- `src/backend/application/domains/workbench/workbench.ts` stores Editor Pane
  state with file identity, text preview, byte length, truncation, and revision.
- `src/backend/application/ports/outbound/workspace-file-port.ts` currently has
  read and exact-replace methods, but no whole-file human save method.
- `src/desktop/adapters/inbound/react-renderer/tide-product-shell.ts` currently
  renders Editor Pane text through a `<pre>` preview block.

## Decisions

### D1. Human save is not an Agent edit tool

The new write path is a `workbench.command` named `save_editor_file`.

It is not exposed as a Tide MCP tool and does not change `tide_edit_file`.
Agents still use exact replacements unless a later spec deliberately adds a new
agent-facing capability.

### D2. Save targets the opened Editor Pane

Desktop sends:

- `threadId`
- `targetPaneId`
- `data.baseRevision`
- `data.content`

Backend resolves the target Pane from the Thread Workbench. The file path comes
from the Backend-owned Editor Pane state, not from Desktop command data.

### D3. Stale revision rejects before writing

Backend rejects `save_editor_file` when `baseRevision` does not match the
current Editor Pane revision. This prevents an older Desktop draft from
silently overwriting an Agent edit or a refreshed Pane.

### D4. Truncated Editor Panes are read-only

If an Editor Pane is truncated, Desktop may show the text but must not offer a
save action. Backend also rejects save attempts for truncated Editor Panes.

### D5. Shared Contracts carry editable Editor text

Editor Pane refs include optional `bodyText` for full editable text.
`bodyTextPreview` remains for existing preview rendering and bounded display.
For editable Editor Panes, both fields may carry the same content.

### D6. Desktop owns draft state only

Desktop can mark an Editor Pane draft dirty and keep unsaved text locally.
Backend remains the only boundary that writes files.

### D7. The Editor Pane uses a real code editor (CodeMirror 6)

The Editor Pane renders CodeMirror 6 (`@uiw/react-codemirror`), not a plain
textarea or a hand-rolled highlighter. This gives grammar-based syntax
highlighting (Lezer), line numbers, and selection, with editing wired to the
same draft/save handlers and read-only Panes rendered with editing disabled.
CodeMirror and its language/parser packages are MIT-licensed, compatible with
open-source distribution. Because CodeMirror mounts in a real DOM, its rendering
is verified with jsdom-backed tests rather than the SSR snapshot path.

## Domain Model

```ts
interface EditorPaneState {
  paneId: string;
  kind: "editor";
  title: string;
  filePath: string;
  relativePath: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  bodyText: string;
  bodyTextPreview: string;
  byteLength: number;
  truncated: boolean;
}
```

```ts
interface WorkspaceFilePort {
  writeTextFile(input: {
    root: string;
    path: string;
    content: string;
    byteLimit: number;
  }): Promise<WorkspaceFileWriteResult>;
}
```

## Contracts

### Workbench Pane ref

Editor refs add:

```ts
{
  bodyText?: string;
}
```

### Workbench command

```ts
{
  kind: "workbench.command",
  payload: {
    threadId: string;
    command: "save_editor_file";
    targetPaneId: string;
    data: {
      baseRevision: string;
      content: string;
    };
  };
}
```

## Flow

### UC-1: Open editable Editor Pane

1. Agent or user action opens a file through `tide_open_file`.
2. Backend reads bounded text under the active Thread root.
3. If the file is not truncated, Backend snapshots the Editor Pane with
   `bodyText`.
4. Desktop renders the Editor Pane as editable text.

### UC-2: Save Editor Pane

1. User edits the Editor Pane draft.
2. Desktop marks the local draft dirty.
3. User saves.
4. Desktop emits `workbench.command save_editor_file` with the current Pane id,
   `baseRevision`, and draft `content`.
5. Backend validates Thread, target Pane, revision, root scope, and truncation.
6. Backend writes the file through `WorkspaceFilePort`.
7. Backend refreshes the Editor Pane text, byte length, revision, and updatedAt.
8. Backend returns the updated Workbench snapshot.

### UC-3: Reject stale Editor save

1. Desktop sends `save_editor_file` with an older `baseRevision`.
2. Backend returns `workbench_stale_reference`.
3. Backend does not write the file.
4. Backend does not mutate Workbench state.

## Invariants

1. Desktop never writes files directly.
2. `save_editor_file` writes only the file already attached to the target
   Editor Pane.
3. `save_editor_file` requires matching `baseRevision`.
4. Truncated Editor Panes are read-only.
5. Successful saves increment the Editor Pane revision.
6. Successful saves keep the Editor Pane visible and active.
7. Agent MCP file editing remains exact-replacement-only in this slice.

## Tests

| Rule | Test |
|------|------|
| Contract carries editable text | `workbench_editor_pane_contract_carries_editable_body_text` |
| Backend save writes opened file | `saving_editor_pane_writes_open_file_and_refreshes_revision` |
| Stale save rejects without write | `saving_editor_pane_with_stale_revision_returns_conflict_without_write` |
| Truncated save rejects | `saving_truncated_editor_pane_returns_conflict_without_write` |
| Desktop dirty state | `editing_workbench_editor_pane_marks_draft_dirty` |
| Desktop save command | `saving_workbench_editor_pane_emits_save_editor_file_command` |
| Desktop read-only truncated state | `truncated_workbench_editor_pane_renders_read_only` |
| Editor is a real CodeMirror editor (content + line numbers) | `workbench_editor_pane_mounts_codemirror_with_file_content_and_line_numbers` |
| Editor applies grammar-based highlighting | `workbench_editor_pane_applies_grammar_highlighting_tokens` |

## Implementation Notes

- Keep full file text bounded by the existing file byte limit until a larger
  editor model is specified.
- Use native `<textarea>` for this slice because the current dependency set does
  not include CodeMirror or Monaco.
- Add the richer editor engine and LSP connection as later specs on top of the
  same `bodyText`, file identity, revision, and save contract.
