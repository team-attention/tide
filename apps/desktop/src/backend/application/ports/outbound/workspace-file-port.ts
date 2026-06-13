export type WorkspaceFileErrorCode =
  | "workspace_file_unavailable"
  | "workspace_file_not_found"
  | "workspace_file_outside_scope"
  | "workspace_file_not_text"
  | "workspace_file_unreadable"
  | "workspace_file_too_large"
  | "workspace_file_edit_conflict";

export interface WorkspaceFileError {
  code: WorkspaceFileErrorCode;
  message: string;
}

export interface WorkspaceFileRead {
  root: string;
  path: string;
  relativePath: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}

export type WorkspaceFileReadResult =
  | { ok: true; file: WorkspaceFileRead }
  | { ok: false; error: WorkspaceFileError };

export interface WorkspaceFileEdit {
  root: string;
  path: string;
  relativePath: string;
  replacementCount: number;
  beforeByteLength: number;
  afterByteLength: number;
  beforeContent: string;
  afterContent: string;
  truncated: boolean;
}

export type WorkspaceFileEditResult =
  | { ok: true; file: WorkspaceFileEdit }
  | { ok: false; error: WorkspaceFileError };

export interface WorkspaceFileWrite {
  root: string;
  path: string;
  relativePath: string;
  content: string;
  byteLength: number;
  truncated: boolean;
}

export type WorkspaceFileWriteResult =
  | { ok: true; file: WorkspaceFileWrite }
  | { ok: false; error: WorkspaceFileError };

export interface WorkspaceFileTreeEntry {
  id: string;
  name: string;
  relativePath: string;
  depth: number;
  kind: "folder" | "file";
  active?: boolean;
}

export interface WorkspaceFileTree {
  root: string;
  cwdLabel: string;
  revision: string;
  updatedAt: string;
  entries: WorkspaceFileTreeEntry[];
  truncated: boolean;
}

export type WorkspaceFileTreeResult =
  | { ok: true; fileTree: WorkspaceFileTree }
  | { ok: false; error: WorkspaceFileError };

export interface WorkspaceFileSearchMatch {
  relativePath: string;
  line: number;
  column: number;
  lineText: string;
}

export interface WorkspaceFileSearch {
  query: string;
  matches: WorkspaceFileSearchMatch[];
  fileCount: number;
  truncated: boolean;
}

export type WorkspaceFileSearchResult =
  | { ok: true; search: WorkspaceFileSearch }
  | { ok: false; error: WorkspaceFileError };

export interface WorkspaceFilePort {
  listTree(input: {
    root: string;
    maxEntries: number;
    // Lazy mode: descend only into these expanded folder paths. Absent => the
    // depth-bounded full walk (Quick Open).
    expandedPaths?: string[];
    maxDepth?: number;
  }): Promise<WorkspaceFileTreeResult>;

  readTextFile(input: {
    root: string;
    path: string;
    byteLimit: number;
  }): Promise<WorkspaceFileReadResult>;

  // Project-wide content search (gitignore-filtered). Returns matching lines
  // across files under `root` for a plain-text (case-insensitive) query.
  searchContent(input: {
    root: string;
    query: string;
    maxResults: number;
    maxFiles: number;
  }): Promise<WorkspaceFileSearchResult>;

  replaceText(input: {
    root: string;
    path: string;
    oldText: string;
    newText: string;
    expectedOccurrences: number;
    byteLimit: number;
  }): Promise<WorkspaceFileEditResult>;

  writeTextFile(input: {
    root: string;
    path: string;
    content: string;
    byteLimit: number;
  }): Promise<WorkspaceFileWriteResult>;
}
