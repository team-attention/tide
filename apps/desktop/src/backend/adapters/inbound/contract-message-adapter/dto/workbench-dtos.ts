import type { ThreadSnapshot } from "../../../../application/services/thread/thread-runtime-service.ts";
import type { WorkbenchFileTreeDto, WorkbenchPaneRefDto } from "../../../../../shared/contracts/index.ts";
// Extracted from backend-contract-message-adapter.ts (spec: navigable-source-structure).

export function toWorkbenchPaneRefDto(
  pane: ThreadSnapshot["workbench"]["panes"][number],
): WorkbenchPaneRefDto {
  if (pane.kind === "browser") {
    const dto: WorkbenchPaneRefDto = {
      paneId: pane.paneId,
      kind: "browser",
      title: pane.title,
      revision: pane.revision,
      updatedAt: pane.updatedAt,
      loading: pane.loading,
      agentDriving: pane.agentDriving,
    };
    if (pane.agentCursor !== undefined) {
      dto.agentCursor = { ...pane.agentCursor };
    }
    if (pane.url !== undefined) {
      dto.url = pane.url;
    }
    if (pane.pageTitle !== undefined) {
      dto.pageTitle = pane.pageTitle;
    }
    if (pane.bodyTextPreview !== undefined) {
      dto.bodyTextPreview = pane.bodyTextPreview;
    }
    if (pane.pendingCapture !== undefined) {
      dto.pendingCapture = { ...pane.pendingCapture };
    }
    if (pane.pendingAction !== undefined) {
      dto.pendingAction = { ...pane.pendingAction };
    }
    if (pane.lastAction !== undefined) {
      dto.lastAction = { ...pane.lastAction };
    }
    return dto;
  }
  if (pane.kind === "launcher") {
    return {
      paneId: pane.paneId,
      kind: "launcher",
      title: pane.title,
      revision: pane.revision,
      updatedAt: pane.updatedAt,
      actions: pane.actions.map((action) => ({ ...action })),
    };
  }

  const dto: WorkbenchPaneRefDto = {
    paneId: pane.paneId,
    kind: pane.kind,
    title: pane.title,
    revision: pane.revision,
    updatedAt: pane.updatedAt,
  };
  if (pane.kind === "editor" || pane.kind === "diff" || pane.kind === "image") {
    if (pane.filePath !== undefined) {
      dto.filePath = pane.filePath;
    }
    if (pane.relativePath !== undefined) {
      dto.relativePath = pane.relativePath;
    }
    if (pane.truncated !== undefined) {
      dto.truncated = pane.truncated;
    }
  }
  if (pane.kind === "image") {
    if (pane.root !== undefined) {
      dto.root = pane.root;
    }
    if (pane.mimeType !== undefined) {
      dto.mimeType = pane.mimeType;
    }
    if (pane.byteLength !== undefined) {
      dto.byteLength = pane.byteLength;
    }
  }
  if (pane.kind === "editor") {
    if (pane.bodyTextPreview !== undefined) {
      dto.bodyTextPreview = pane.bodyTextPreview;
    }
    if (pane.byteLength !== undefined) {
      dto.byteLength = pane.byteLength;
    }
    if (pane.navigationTarget !== undefined) {
      dto.navigationTarget = { ...pane.navigationTarget };
    }
    if (pane.references !== undefined) {
      dto.references = {
        query: pane.references.query,
        truncated: pane.references.truncated,
        items: pane.references.items.map((item) => ({ ...item })),
      };
    }
  }
  if (pane.kind === "diff") {
    if (pane.diffText !== undefined) {
      dto.diffText = pane.diffText;
    }
    if (pane.beforeByteLength !== undefined) {
      dto.beforeByteLength = pane.beforeByteLength;
    }
    if (pane.afterByteLength !== undefined) {
      dto.afterByteLength = pane.afterByteLength;
    }
  }
  if (pane.kind === "terminal") {
    if (pane.terminalRole !== undefined) {
      dto.terminalRole = pane.terminalRole;
    }
    if (pane.command !== undefined) {
      dto.command = pane.command;
    }
    if (pane.args !== undefined) {
      dto.args = pane.args.map((arg) => arg);
    }
    if (pane.cwd !== undefined) {
      dto.cwd = pane.cwd;
    }
    if (pane.status !== undefined) {
      dto.status = pane.status;
    }
    if (pane.expectedCompletion !== undefined) {
      dto.expectedCompletion = pane.expectedCompletion;
    }
    if (pane.transcriptPreview !== undefined) {
      dto.transcriptPreview = pane.transcriptPreview;
    }
    if (pane.exitCode !== undefined) {
      dto.exitCode = pane.exitCode;
    }
    if (pane.signal !== undefined) {
      dto.signal = pane.signal;
    }
    if (pane.timedOut !== undefined) {
      dto.timedOut = pane.timedOut;
    }
    if (pane.startedAt !== undefined) {
      dto.startedAt = pane.startedAt;
    }
    if (pane.completedAt !== undefined) {
      dto.completedAt = pane.completedAt;
    }
  }
  if (pane.kind === "changes" && pane.cwd !== undefined) {
    dto.cwd = pane.cwd;
  }
  return dto;
}

export function toWorkbenchFileTreeDto(
  fileTree: NonNullable<ThreadSnapshot["workbench"]["fileTree"]>,
): WorkbenchFileTreeDto {
  return {
    root: fileTree.root,
    cwdLabel: fileTree.cwdLabel,
    revision: fileTree.revision,
    updatedAt: fileTree.updatedAt,
    truncated: fileTree.truncated,
    entries: fileTree.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      relativePath: entry.relativePath,
      depth: entry.depth,
      kind: entry.kind,
      ...(entry.active === undefined ? {} : { active: entry.active }),
    })),
  };
}

export function omitUndefinedProperties<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as T;
}
