import type {
  ReadWorkspaceFileResult,
  ReadWorkspaceFileTreeResult,
  ReadWorkspaceImageFileResult,
  SearchWorkspaceContentResult,
  WriteWorkspaceFileResult,
} from "../../../../application/services/workbench/workspace-query-handler.ts";
import {
  CONTRACT_VERSION,
  type BackendEventEnvelope,
  type BackendEventId,
  type RequestId,
} from "../../../../../shared/contracts/index.ts";
import { toWorkbenchFileTreeDto } from "./workbench-dtos.ts";

export interface WorkspaceQueryEventMeta {
  eventId: BackendEventId;
  requestId: RequestId;
  emittedAt: string;
}

export function workspaceFileTreeLoadedEvent(
  meta: WorkspaceQueryEventMeta,
  result: ReadWorkspaceFileTreeResult,
): BackendEventEnvelope<"workspace.fileTreeLoaded"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: meta.eventId,
    requestId: meta.requestId,
    kind: "workspace.fileTreeLoaded",
    emittedAt: meta.emittedAt,
    payload: {
      cwd: result.cwd,
      fileTree: toWorkbenchFileTreeDto(result.fileTree),
    },
  };
}

export function workspaceContentSearchResultsEvent(
  meta: WorkspaceQueryEventMeta,
  result: SearchWorkspaceContentResult,
): BackendEventEnvelope<"workspace.contentSearchResults"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: meta.eventId,
    requestId: meta.requestId,
    kind: "workspace.contentSearchResults",
    emittedAt: meta.emittedAt,
    payload: {
      cwd: result.cwd,
      query: result.query,
      matches: result.matches.map((match) => ({ ...match })),
      fileCount: result.fileCount,
      truncated: result.truncated,
    },
  };
}

export function workspaceFileLoadedEvent(
  meta: WorkspaceQueryEventMeta,
  result: ReadWorkspaceFileResult,
): BackendEventEnvelope<"workspace.fileLoaded"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: meta.eventId,
    requestId: meta.requestId,
    kind: "workspace.fileLoaded",
    emittedAt: meta.emittedAt,
    payload: {
      cwd: result.cwd,
      relativePath: result.relativePath,
      content: result.content,
      truncated: result.truncated,
    },
  };
}

export function workspaceImageLoadedEvent(
  meta: WorkspaceQueryEventMeta,
  result: ReadWorkspaceImageFileResult,
): BackendEventEnvelope<"workspace.imageLoaded"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: meta.eventId,
    requestId: meta.requestId,
    kind: "workspace.imageLoaded",
    emittedAt: meta.emittedAt,
    payload: {
      cwd: result.cwd,
      relativePath: result.relativePath,
      mimeType: result.mimeType,
      dataBase64: result.dataBase64,
      byteLength: result.byteLength,
    },
  };
}

export function workspaceFileSavedEvent(
  meta: WorkspaceQueryEventMeta,
  result: WriteWorkspaceFileResult,
): BackendEventEnvelope<"workspace.fileSaved"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: meta.eventId,
    requestId: meta.requestId,
    kind: "workspace.fileSaved",
    emittedAt: meta.emittedAt,
    payload: {
      cwd: result.cwd,
      relativePath: result.relativePath,
      content: result.content,
      truncated: result.truncated,
    },
  };
}
