# Spec: Tide MCP File Edit And Diff Tools

## Scope

This spec extends the File Workbench tool slice so an Agent can make bounded text edits through Tide-owned tools and expose the resulting diff in the Thread Workbench.

It covers:

- Replacing exact text inside a file under the active Thread Execution Context.
- Rejecting stale or ambiguous edits.
- Returning a bounded unified diff summary.
- Creating or refreshing a visible Diff Pane for the edited file.
- Refreshing an existing Editor Pane for the edited file.
- Rendering successful edit tool results as file edit / diff summary Agent Session Blocks when structured frames are available.

It does not cover:

- Arbitrary overwrite without old text.
- Multi-file patch application.
- Git index staging, commit, or review approval.
- Binary file editing.
- Full visible diff editor interactions.

## Evidence

- `docs_v2/glossary.md` defines Workbench, Workbench Pane, Diff Pane, Editor Pane, Tide MCP Tool Surface, Execution Context, and Agent Session Block.
- `docs_v2/master-plan.md` says Workbench can contain Diff and Editor Panes, and Agent Session vocabulary includes file edit and diff summary.
- `docs_v2/implementation/concrete-design-backlog.md` lists open Diff/File view and read Diff/File state as initial Tide MCP tool groups, and chooses Tide-owned MCP tools over external shell delegation.
- `docs_v2/specs/tide-mcp-file-workbench-tools.md` already defines Thread-root-scoped file read/open behavior and keeps editing out of that first slice.
- `src/backend/application/ports/outbound/workspace-file-port.ts` currently exposes only bounded file read, so edits require an explicit outward file port method.

## Decisions

### D1. First edit tool is exact replacement

The first write-capable tool is:

- `tide_edit_file`

It requires:

- `path`
- `oldText`
- `newText`

Optional:

- `expectedOccurrences`, default `1`
- `byteLimit` for returned previews and diff bounds

The edit succeeds only when `oldText` occurs exactly `expectedOccurrences` times.

### D2. File edits stay Thread-root scoped

The file path is resolved under the same active Thread root used by `tide_read_file` and `tide_open_file`.

### D3. Edit output owns the first diff summary

`tide_edit_file` returns:

- path metadata
- replacement count
- before / after byte lengths
- bounded after preview
- bounded unified diff text
- visible Diff Pane ref

This gives Agents and Desktop one structured result without needing to run a second shell diff command.

### D4. Edit creates or refreshes a Diff Pane

Successful edits create or refresh one visible Diff Pane per edited file path.

The Diff Pane remains a Workbench Pane attached to the Thread. It is not a Git review workflow.

### D5. Existing Editor Pane refreshes after edit

If the edited file already has a visible or hidden Editor Pane in the Thread Workbench, Tide refreshes its preview and revision after writing the file.

### D6. Structured edit tool results can render richer blocks

When an Agent Runtime emits a structured `tool_result` for `tide_edit_file`, the fixture Agent Session reader may render it as:

- `file_edit`
- `diff_summary`

Unknown or provider-native edit output still falls back to raw/tool blocks.

## Domain Model

```ts
interface WorkspaceFileEdit {
  root: string;
  path: string;
  relativePath: string;
  replacementCount: number;
  beforeByteLength: number;
  afterByteLength: number;
  afterContent: string;
  truncated: boolean;
}
```

```ts
interface DiffPaneState {
  paneId: string;
  kind: "diff";
  title: string;
  filePath: string;
  relativePath: string;
  visible: boolean;
  revision: string;
  updatedAt: string;
  diffText: string;
  truncated: boolean;
  beforeByteLength: number;
  afterByteLength: number;
}
```

## Contracts

### Tool input

```ts
{
  path: string;
  oldText: string;
  newText: string;
  expectedOccurrences?: number;
  byteLimit?: number;
}
```

### Tool output

```ts
{
  kind: "edit_file";
  threadId: string;
  root: string;
  path: string;
  relativePath: string;
  replacementCount: number;
  beforeByteLength: number;
  afterByteLength: number;
  afterContent: string;
  truncated: boolean;
  diff: string;
  pane: DiffPaneRef;
  visibleSideEffect: "created" | "refreshed";
}
```

## Flow

### UC-1: Edit a file by exact replacement

1. Agent calls `tide_edit_file`.
2. Backend resolves the active Thread from the MCP Session.
3. Backend resolves `path` under the Thread root.
4. Backend reads a bounded text file for editing.
5. Backend verifies `oldText` occurrence count.
6. Backend writes the replacement.
7. Backend creates or refreshes a Diff Pane.
8. Backend refreshes an existing Editor Pane for the same file.
9. Backend returns edit metadata, preview, and diff summary.

### UC-2: Reject stale or ambiguous edit

1. Agent calls `tide_edit_file` with missing, absent, or over-matching `oldText`.
2. Backend returns `workspace_file_edit_conflict`.
3. Backend does not write the file.
4. Backend does not mutate Workbench panes.

### UC-3: Render structured edit result

1. Agent Runtime emits a structured `tool_result` for `tide_edit_file`.
2. Agent Session reader sees output kind `edit_file`.
3. Reader emits file edit and diff summary blocks.

## Invariants

1. File edits operate only inside the active Thread root.
2. File edits require exact `oldText`; Tide does not accept arbitrary overwrite in this slice.
3. Ambiguous replacement count rejects before write.
4. Workbench mutation happens only after a successful write.
5. Diff Pane identity is stable per edited file path inside the Thread.
6. Editor Pane previews refresh after edits to the same file.
7. Diff text is bounded before it enters Thread snapshot or Agent Session output.

## Tests

| Rule | Test |
|------|------|
| Tool list includes edit tool | `tide_mcp_tool_surface_lists_bounded_workbench_tools` |
| Exact replacement writes file and opens Diff Pane | `editing_file_replaces_exact_text_and_opens_diff_pane` |
| Existing Editor Pane refreshes after edit | `editing_file_refreshes_existing_editor_pane_preview` |
| Missing old text rejects without mutation | `editing_file_with_missing_old_text_returns_conflict_without_mutating_workbench` |
| Structured edit result renders richer blocks | `structured_file_edit_tool_result_renders_file_edit_and_diff_blocks` |

## Implementation Notes

- Add a write-capable method to `WorkspaceFilePort`; keep Node filesystem access in the Node adapter.
- Keep diff generation small and deterministic. A simple bounded unified-style summary is enough for this slice.
- Keep edit output JSON small enough to pass through OpenAI function-call output safely.
