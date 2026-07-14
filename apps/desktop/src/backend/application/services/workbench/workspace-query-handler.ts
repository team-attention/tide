import type { WorkbenchFileTreeView } from "../../domains/workbench/workbench.ts";
import type {
  WorkspaceCodeCompletionItem,
  WorkspaceCodeDiagnostic,
  WorkspaceCodeHover,
  WorkspaceCodeIntelligencePort,
  WorkspaceCodeLocation,
  WorkspaceCodeRange,
  WorkspaceCodeSignatureHelp,
} from "../../ports/outbound/workspace-code-intelligence-port.ts";
import type { WorkspaceFilePort } from "../../ports/outbound/workspace-file-port.ts";
import { failure, type ServiceResult } from "../support/service-result.ts";
import {
  fileByteLimit,
  fileTreeExpandedPaths,
  fileTreeMaxDepth,
  fileTreeMaxEntries,
  imageByteLimit,
} from "../support/service-value-helpers.ts";
import { cloneFileTreeView } from "../thread/thread-runtime-clone.ts";

// THREAD-INDEPENDENT workspace reads/writes, keyed by an explicit cwd instead of
// a thread root: the start (New Thread) page's file tree, file viewer/editor and
// its save, the Cmd+Shift+F content search, and the editor's language-intelligence
// queries. Extracted from WorkbenchCommandHandler (file-size ratchet), which keeps
// the thread-bound Workbench commands.

export interface ReadWorkspaceFileTreeInput {
  cwd: string;
  // Lazy listing: descend only into these expanded folders. Absent => full walk.
  expandedPaths?: string[];
  maxDepth?: number;
  maxEntries?: number;
}

export interface ReadWorkspaceFileTreeResult {
  cwd: string;
  fileTree: WorkbenchFileTreeView;
}

export interface ReadWorkspaceFileInput {
  cwd: string;
  path: string;
  byteLimit?: number;
  // New File: create an empty file first if missing (spec: workbench-new-file.md).
  create?: boolean;
}

export interface ReadWorkspaceFileResult {
  cwd: string;
  relativePath: string;
  content: string;
  truncated: boolean;
}

export interface ReadWorkspaceImageFileInput {
  cwd: string;
  path: string;
  byteLimit?: number;
}

export interface ReadWorkspaceImageFileResult {
  cwd: string;
  relativePath: string;
  mimeType: string;
  dataBase64: string;
  byteLength: number;
}

export interface WriteWorkspaceFileInput {
  cwd: string;
  path: string;
  content: string;
  byteLimit?: number;
}

export interface WriteWorkspaceFileResult {
  cwd: string;
  relativePath: string;
  content: string;
  truncated: boolean;
}

export interface SearchWorkspaceContentInput {
  cwd: string;
  query: string;
  maxResults?: number;
  maxFiles?: number;
}

export interface WorkspaceContentSearchMatch {
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

export interface SearchWorkspaceContentResult {
  cwd: string;
  query: string;
  matches: WorkspaceContentSearchMatch[];
  fileCount: number;
  truncated: boolean;
}

export type QueryWorkspaceCodeIntelKind =
  | "completion"
  | "hover"
  | "highlights"
  | "signature"
  | "diagnostics"
  | "definition"
  | "references";

export interface WorkspaceCodeLocationResult {
  relativePath: string;
  line: number;
  character: number;
  length?: number;
  label?: string;
}

export interface QueryWorkspaceCodeIntelInput {
  cwd: string;
  path: string;
  kind: QueryWorkspaceCodeIntelKind;
  content?: string;
  line?: number;
  character?: number;
}

// Engine misses (no language support for the file, no server on PATH) are a
// NORMAL answer (`available: false` + message), not a ServiceResult failure —
// the editor quietly shows nothing instead of surfacing contract errors per
// query. (`available` avoids colliding with ServiceResult's own `ok`.)
export interface QueryWorkspaceCodeIntelResult {
  kind: QueryWorkspaceCodeIntelKind;
  available: boolean;
  message?: string;
  completions?: WorkspaceCodeCompletionItem[];
  hover?: WorkspaceCodeHover | null;
  highlights?: WorkspaceCodeRange[];
  signature?: WorkspaceCodeSignatureHelp | null;
  diagnostics?: WorkspaceCodeDiagnostic[];
  definition?: WorkspaceCodeLocationResult | null;
  references?: { items: WorkspaceCodeLocationResult[]; truncated: boolean };
}

export interface WorkspaceQueryHandlerDeps {
  workspaceFilePort: WorkspaceFilePort;
  workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;
}

export class WorkspaceQueryHandler {
  private readonly workspaceFilePort: WorkspaceFilePort;
  private readonly workspaceCodeIntelligencePort: WorkspaceCodeIntelligencePort;

  constructor(deps: WorkspaceQueryHandlerDeps) {
    this.workspaceFilePort = deps.workspaceFilePort;
    this.workspaceCodeIntelligencePort = deps.workspaceCodeIntelligencePort;
  }

  async readWorkspaceFileTree(
    input: ReadWorkspaceFileTreeInput,
  ): Promise<ServiceResult<ReadWorkspaceFileTreeResult>> {
    // Same workspace file port as the thread-bound refresh_file_tree: complete
    // lazy FileTree when `expandedPaths` is present, bounded full walk otherwise.
    const listed = await this.workspaceFilePort.listTree({
      root: input.cwd,
      maxEntries: fileTreeMaxEntries(input.maxEntries),
      expandedPaths: fileTreeExpandedPaths(input.expandedPaths),
      maxDepth: fileTreeMaxDepth(input.maxDepth),
    });
    if (!listed.ok) {
      return failure(listed.error.code, listed.error.message);
    }
    return {
      ok: true,
      cwd: input.cwd,
      fileTree: cloneFileTreeView(listed.fileTree),
    };
  }

  // The start page's viewer shows a file before any thread exists. Same byte
  // limit as the workbench's open_file.
  async readWorkspaceFile(
    input: ReadWorkspaceFileInput,
  ): Promise<ServiceResult<ReadWorkspaceFileResult>> {
    const read = await this.workspaceFilePort.readTextFile({
      root: input.cwd,
      path: input.path,
      byteLimit: fileByteLimit(input.byteLimit),
      create: input.create,
    });
    if (!read.ok) {
      return failure(read.error.code, read.error.message);
    }
    return {
      ok: true,
      cwd: input.cwd,
      relativePath: read.file.relativePath,
      content: read.file.content,
      truncated: read.file.truncated,
    };
  }

  async readWorkspaceImageFile(
    input: ReadWorkspaceImageFileInput,
  ): Promise<ServiceResult<ReadWorkspaceImageFileResult>> {
    const read = await this.workspaceFilePort.readImageFile({
      root: input.cwd,
      path: input.path,
      byteLimit: imageByteLimit(input.byteLimit),
    });
    if (!read.ok) {
      return failure(read.error.code, read.error.message);
    }
    return {
      ok: true,
      cwd: input.cwd,
      relativePath: read.file.relativePath,
      mimeType: read.file.mimeType,
      dataBase64: read.file.dataBase64,
      byteLength: read.file.byteLength,
    };
  }

  // The start page's editor saves a file before any thread exists. Same workspace
  // file port + byte limit as the thread-bound save_editor_file, keyed by the
  // composer's cwd instead of a thread root.
  async writeWorkspaceFile(
    input: WriteWorkspaceFileInput,
  ): Promise<ServiceResult<WriteWorkspaceFileResult>> {
    const byteLimit = fileByteLimit(input.byteLimit);
    if (input.content.length > byteLimit) {
      return failure(
        "workspace_file_too_large",
        "Editor content exceeds the bounded save size.",
      );
    }
    const written = await this.workspaceFilePort.writeTextFile({
      root: input.cwd,
      path: input.path,
      content: input.content,
      byteLimit,
    });
    if (!written.ok) {
      return failure(written.error.code, written.error.message);
    }
    return {
      ok: true,
      cwd: input.cwd,
      relativePath: written.file.relativePath,
      content: written.file.content,
      truncated: written.file.truncated,
    };
  }

  async searchWorkspaceContent(
    input: SearchWorkspaceContentInput,
  ): Promise<ServiceResult<SearchWorkspaceContentResult>> {
    const searched = await this.workspaceFilePort.searchContent({
      root: input.cwd,
      query: input.query,
      maxResults: Math.min(Math.max(input.maxResults ?? 500, 1), 2000),
      maxFiles: Math.min(Math.max(input.maxFiles ?? 2000, 1), 8000),
    });
    if (!searched.ok) {
      return failure(searched.error.code, searched.error.message);
    }
    return {
      ok: true,
      cwd: input.cwd,
      query: searched.search.query,
      matches: searched.search.matches.map((match) => ({ ...match })),
      fileCount: searched.search.fileCount,
      truncated: searched.search.truncated,
    };
  }

  async queryWorkspaceCodeIntel(
    input: QueryWorkspaceCodeIntelInput,
  ): Promise<ServiceResult<QueryWorkspaceCodeIntelResult>> {
    const query = {
      root: input.cwd,
      path: input.path,
      line: input.line ?? 0,
      character: input.character ?? 0,
      content: input.content,
    };
    const miss = (message: string): ServiceResult<QueryWorkspaceCodeIntelResult> => ({
      ok: true,
      kind: input.kind,
      available: false,
      message,
    });
    switch (input.kind) {
      case "completion": {
        const result = await this.workspaceCodeIntelligencePort.getCompletions(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, completions: result.completions }
          : miss(result.error.message);
      }
      case "hover": {
        const result = await this.workspaceCodeIntelligencePort.getHover(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, hover: result.hover }
          : miss(result.error.message);
      }
      case "highlights": {
        const result = await this.workspaceCodeIntelligencePort.getDocumentHighlights(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, highlights: result.highlights }
          : miss(result.error.message);
      }
      case "signature": {
        const result = await this.workspaceCodeIntelligencePort.getSignatureHelp(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, signature: result.signature }
          : miss(result.error.message);
      }
      case "diagnostics": {
        const result = await this.workspaceCodeIntelligencePort.getDiagnostics({
          root: query.root,
          path: query.path,
          content: query.content,
        });
        return result.ok
          ? { ok: true, kind: input.kind, available: true, diagnostics: result.diagnostics }
          : miss(result.error.message);
      }
      case "definition": {
        const result = await this.workspaceCodeIntelligencePort.findDefinition(query);
        return result.ok
          ? { ok: true, kind: input.kind, available: true, definition: toLocationResult(result.location) }
          : miss(result.error.message);
      }
      case "references": {
        const result = await this.workspaceCodeIntelligencePort.findReferences(query);
        return result.ok
          ? {
              ok: true,
              kind: input.kind,
              available: true,
              references: {
                items: result.locations.map(toLocationResult),
                truncated: result.truncated,
              },
            }
          : miss(result.error.message);
      }
      default:
        return failure("invalid_workbench_command", "Unknown code intelligence query kind.");
    }
  }
}

// The editor only needs the in-workspace location (relative path + position),
// not the engine's absolute root/path.
function toLocationResult(location: WorkspaceCodeLocation): WorkspaceCodeLocationResult {
  return {
    relativePath: location.relativePath,
    line: location.line,
    character: location.character,
    length: location.length,
    label: location.label,
  };
}
