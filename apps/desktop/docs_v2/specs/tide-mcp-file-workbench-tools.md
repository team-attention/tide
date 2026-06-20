# Spec: Tide MCP File Workbench Tools

## Scope

This spec adds the first File Workbench tool slice to Tide MCP Tool Surface.

It covers:

- Reading a bounded text file from the active Thread Execution Context.
- Opening a visible Editor Pane for a text file.
- Returning Editor Pane refs through Workbench snapshots.
- Preventing path traversal outside the active Thread root.
- Exposing the file tools to Provider CLI Agents through the same Tide MCP Tool Surface list.

It does not cover:

- Editing or writing files.
- Diff generation or review actions.
- FileTree directory listing.
- Binary file previews.
- Syntax highlighting or full editor rendering.

## Evidence

- `docs_v2/glossary.md` defines Workbench Pane, Editor Pane, File Workbench Pane/View, Execution Context, and Tide MCP Tool Surface.
- `docs_v2/implementation/concrete-design-backlog.md` lists open Diff/File view and read Diff/File state as initial Tide MCP tool groups.
- `docs_v2/specs/tide-mcp-workbench-observe-open-browser.md` already defines Thread-scoped MCP Session authorization and Workbench visible side-effect rules.
- `src/backend/application/services/thread-runtime-service.ts` already routes Tide MCP tool calls through the active Thread and validates the Agent Runtime session.
- `src/backend/application/domains/workbench/workbench.ts` already names `editor` as a Workbench Pane kind, but the current Workbench state union only stores Browser and Terminal panes.

## Decisions

### D1. File tools are Thread-root scoped

File paths resolve under the active Thread root:

- Project Thread: `ThreadScope.project.cwd`.
- Scratch Thread: `ThreadScope.scratch.scratchCwd`.

Absolute paths are allowed only when they remain inside that root after resolution.

### D2. First file tools are read-only

This slice adds:

- `tide_read_file`
- `tide_open_file`

It does not add write, patch, or diff tools.

### D3. Open file creates or reveals an Editor Pane

`tide_open_file` creates a visible Editor Pane when one does not already exist for the resolved file path.

If an Editor Pane for the file already exists, the tool reveals and refreshes it.

### D4. File content is bounded

Both file tools read a bounded UTF-8 preview.

The result includes:

- resolved path
- relative path
- byte length
- whether the preview was truncated
- text preview/content

Binary-looking files are rejected for this first slice.

### D5. Same tool list feeds Provider CLI Agents

The tool definitions returned by `listTideMcpTools()` include Browser and File Workbench tools.

Provider CLI Agents receive them through provider-attached MCP.

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
  bodyTextPreview: string;
  truncated: boolean;
  byteLength: number;
}
```

```ts
interface WorkspaceFilePort {
  readTextFile(input: {
    root: string;
    path: string;
    byteLimit: number;
  }): Promise<WorkspaceFileReadResult>;
}
```

## Flow

### UC-1: Read a file

1. Agent calls `tide_read_file` with a path.
2. Backend resolves the active Thread from MCP Session.
3. Backend resolves the path under the Thread root.
4. Backend reads a bounded UTF-8 preview.
5. Backend returns file content and metadata without changing Workbench state.

### UC-2: Open a file

1. Agent calls `tide_open_file` with a path.
2. Backend resolves and reads the file.
3. Backend creates or refreshes an Editor Pane attached to the active Thread Workbench.
4. Workbench snapshot includes the Editor Pane ref.
5. Human Composer focus remains preserved by default.

### UC-3: Reject outside-root paths

1. Agent calls a file tool with a path outside the active Thread root.
2. Backend returns a structured `workspace_file_outside_scope` error.
3. Workbench state is not mutated.

## Invariants

1. File tools operate only inside the active Thread root.
2. File tools use a Backend outward file port, not Desktop or renderer filesystem access.
3. `tide_read_file` does not mutate Workbench panes.
4. `tide_open_file` creates or reveals an Editor Pane and preserves Composer focus.
5. Editor Pane refs keep stable `paneId`, `revision`, `relativePath`, and bounded preview metadata.
6. Binary-looking file content is rejected instead of rendered as text.

## Tests

| Rule | Test |
|------|------|
| Tool list includes Browser and File Workbench tools | `tide_mcp_tool_surface_lists_bounded_workbench_tools` |
| Read file returns bounded content without mutating Workbench | `reading_file_returns_bounded_content_without_mutating_workbench` |
| Open file creates visible Editor Pane | `opening_file_creates_visible_editor_pane_in_thread_workbench` |
| Open file refreshes existing Editor Pane | `opening_existing_file_reveals_existing_editor_pane` |
| Outside root path is rejected | `reading_file_outside_thread_root_returns_structured_error` |

## Implementation Notes

- Keep path resolution and filesystem reads behind `WorkspaceFilePort`.
- Keep Workbench mutation in `ThreadRuntimeService`.
- Keep the preview byte limit modest for Agent Session and Workbench snapshots.
- Preserve raw structured tool errors for the calling Agent.
