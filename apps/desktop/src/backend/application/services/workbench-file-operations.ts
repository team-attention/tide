import type { ThreadRecord } from "../domains/thread/thread.ts";
import type {
  DiffPaneState,
  EditorPaneState,
  WorkbenchPaneSnapshotRef,
} from "../domains/workbench/workbench.ts";
import type {
  WorkspaceFileEdit,
  WorkspaceFilePort,
  WorkspaceFileRead,
  WorkspaceFileWrite,
} from "../ports/outbound/workspace-file-port.ts";
import { boundedDiffText, unifiedContentDiff } from "./diff-text.ts";
import { literalStringField } from "./record-helpers.ts";
import { failure, type ServiceResult } from "./service-result.ts";
import {
  expectedOccurrences,
  fileByteLimit,
  optionalString,
  titleFromRelativePath,
} from "./service-value-helpers.ts";
import { threadRoot } from "./thread-snapshot.ts";
import type {
  TideEditFileOutput,
  TideOpenFileOutput,
  TideReadFileOutput,
} from "./tide-mcp-output.ts";
import { diffPaneRef, editorPaneRef } from "./workbench-snapshot.ts";

// File/editor operations for the Workbench: read a file, open it in an Editor
// pane, apply an edit and render the Diff pane, and refresh editor panes after
// edit/write. Shared by the workbench-command and Tide MCP paths. Depends only on
// the workspace file port + clock/id. Extracted from thread-runtime-service.ts.
export interface WorkbenchFileOperationsDeps {
  workspaceFilePort: WorkspaceFilePort;
  clock: () => string;
  idGenerator: () => string;
}

export class WorkbenchFileOperations {
  private readonly workspaceFilePort: WorkspaceFilePort;
  private readonly clock: () => string;
  private readonly idGenerator: () => string;

  constructor(deps: WorkbenchFileOperationsDeps) {
    this.workspaceFilePort = deps.workspaceFilePort;
    this.clock = deps.clock;
    this.idGenerator = deps.idGenerator;
  }

  async readFileOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideReadFileOutput }>> {
    const file = await this.readThreadFile(thread, input);
    if (!file.ok) {
      return file;
    }

    return {
      ok: true,
      value: {
        kind: "read_file",
        threadId: thread.threadId,
        root: file.value.root,
        path: file.value.path,
        relativePath: file.value.relativePath,
        content: file.value.content,
        byteLength: file.value.byteLength,
        truncated: file.value.truncated,
      },
    };
  }

  async openFileOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideOpenFileOutput }>> {
    const file = await this.readThreadFile(thread, input);
    if (!file.ok) {
      return file;
    }

    const existingPane = thread.workbench.panes.find(
      (pane): pane is EditorPaneState =>
        pane.kind === "editor" && pane.filePath === file.value.path,
    );
    const visibleSideEffect = existingPane === undefined ? "created" : "revealed";
    const pane =
      existingPane ??
      ({
        paneId: this.idGenerator(),
        kind: "editor",
        title: titleFromRelativePath(file.value.relativePath),
        filePath: file.value.path,
        relativePath: file.value.relativePath,
        visible: true,
        revision: this.idGenerator(),
        updatedAt: this.clock(),
        bodyText: file.value.content,
        bodyTextPreview: file.value.content,
        byteLength: file.value.byteLength,
        truncated: file.value.truncated,
      } satisfies EditorPaneState);

    pane.visible = true;
    pane.title = titleFromRelativePath(file.value.relativePath);
    pane.relativePath = file.value.relativePath;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    pane.bodyText = file.value.content;
    pane.bodyTextPreview = file.value.content;
    pane.byteLength = file.value.byteLength;
    pane.truncated = file.value.truncated;

    if (existingPane === undefined) {
      thread.workbench.panes.push(pane);
    }
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";

    return {
      ok: true,
      value: {
        kind: "open_file",
        threadId: thread.threadId,
        pane: editorPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "editor" },
        root: file.value.root,
        path: file.value.path,
        relativePath: file.value.relativePath,
        byteLength: file.value.byteLength,
        truncated: file.value.truncated,
        visibleSideEffect,
      },
    };
  }

  async editFileOutput(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: TideEditFileOutput }>> {
    const edit = await this.editThreadFile(thread, input);
    if (!edit.ok) {
      return edit;
    }

    const diff = boundedDiffText(
      unifiedContentDiff(
        edit.value.relativePath,
        edit.value.beforeContent,
        edit.value.afterContent,
      ),
      fileByteLimit(input?.byteLimit),
    );
    const existingPane = thread.workbench.panes.find(
      (pane): pane is DiffPaneState =>
        pane.kind === "diff" && pane.filePath === edit.value.path,
    );
    const visibleSideEffect = existingPane === undefined ? "created" : "refreshed";
    const pane =
      existingPane ??
      ({
        paneId: this.idGenerator(),
        kind: "diff",
        title: `Diff: ${titleFromRelativePath(edit.value.relativePath)}`,
        filePath: edit.value.path,
        relativePath: edit.value.relativePath,
        visible: true,
        revision: this.idGenerator(),
        updatedAt: this.clock(),
        diffText: diff,
        truncated: edit.value.truncated,
        beforeByteLength: edit.value.beforeByteLength,
        afterByteLength: edit.value.afterByteLength,
      } satisfies DiffPaneState);

    pane.visible = true;
    pane.title = `Diff: ${titleFromRelativePath(edit.value.relativePath)}`;
    pane.relativePath = edit.value.relativePath;
    pane.diffText = diff;
    pane.truncated = edit.value.truncated || diff.endsWith("\n[diff truncated]");
    pane.beforeByteLength = edit.value.beforeByteLength;
    pane.afterByteLength = edit.value.afterByteLength;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();

    if (existingPane === undefined) {
      thread.workbench.panes.push(pane);
    }

    this.refreshEditorPaneAfterEdit(thread, edit.value);
    thread.workbench.activePaneId = pane.paneId;
    thread.workbench.focusOwner = "composer";

    return {
      ok: true,
      value: {
        kind: "edit_file",
        threadId: thread.threadId,
        pane: diffPaneRef(pane) as WorkbenchPaneSnapshotRef & { kind: "diff" },
        root: edit.value.root,
        path: edit.value.path,
        relativePath: edit.value.relativePath,
        replacementCount: edit.value.replacementCount,
        beforeByteLength: edit.value.beforeByteLength,
        afterByteLength: edit.value.afterByteLength,
        afterContent: edit.value.afterContent,
        truncated: edit.value.truncated,
        diff,
        visibleSideEffect,
      },
    };
  }

  async readThreadFile(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: WorkspaceFileRead }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_file_unavailable",
        "Thread does not have an Execution Context root for file tools.",
      );
    }

    const filePath = optionalString(input?.path);
    if (filePath === undefined) {
      return failure("workspace_file_unreadable", "File path is required.");
    }

    const read = await this.workspaceFilePort.readTextFile({
      root,
      path: filePath,
      byteLimit: fileByteLimit(input?.byteLimit),
    });
    if (!read.ok) {
      return failure(read.error.code, read.error.message);
    }

    return { ok: true, value: read.file };
  }

  async editThreadFile(
    thread: ThreadRecord,
    input: Record<string, unknown> | undefined,
  ): Promise<ServiceResult<{ value: WorkspaceFileEdit }>> {
    const root = threadRoot(thread);
    if (root === undefined) {
      return failure(
        "workspace_file_unavailable",
        "Thread does not have an Execution Context root for file tools.",
      );
    }

    const filePath = optionalString(input?.path);
    if (filePath === undefined) {
      return failure("workspace_file_unreadable", "File path is required.");
    }
    const oldText = literalStringField(input, "oldText");
    const newText = literalStringField(input, "newText");
    if (oldText === undefined || newText === undefined) {
      return failure(
        "workspace_file_edit_conflict",
        "File edit requires oldText and newText.",
      );
    }

    const edit = await this.workspaceFilePort.replaceText({
      root,
      path: filePath,
      oldText,
      newText,
      expectedOccurrences: expectedOccurrences(input?.expectedOccurrences),
      byteLimit: fileByteLimit(input?.byteLimit),
    });
    if (!edit.ok) {
      return failure(edit.error.code, edit.error.message);
    }

    return { ok: true, value: edit.file };
  }

  refreshEditorPaneAfterEdit(thread: ThreadRecord, file: WorkspaceFileEdit): void {
    const pane = thread.workbench.panes.find(
      (candidate): candidate is EditorPaneState =>
        candidate.kind === "editor" && candidate.filePath === file.path,
    );
    if (pane === undefined) {
      return;
    }

    pane.visible = true;
    pane.title = titleFromRelativePath(file.relativePath);
    pane.relativePath = file.relativePath;
    pane.bodyText = file.afterContent;
    pane.bodyTextPreview = file.afterContent;
    pane.byteLength = file.afterByteLength;
    pane.truncated = file.truncated;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
  }

  refreshEditorPaneAfterWrite(
    thread: ThreadRecord,
    pane: EditorPaneState,
    file: WorkspaceFileWrite,
  ): void {
    pane.visible = true;
    pane.title = titleFromRelativePath(file.relativePath);
    pane.filePath = file.path;
    pane.relativePath = file.relativePath;
    pane.bodyText = file.content;
    pane.bodyTextPreview = file.content;
    pane.byteLength = file.byteLength;
    pane.truncated = file.truncated;
    pane.revision = this.idGenerator();
    pane.updatedAt = this.clock();
    thread.workbench.activePaneId = pane.paneId;
  }
}
