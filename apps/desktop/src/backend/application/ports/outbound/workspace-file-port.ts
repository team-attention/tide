export type WorkspaceFileErrorCode =
  | "workspace_file_unavailable"
  | "workspace_file_not_found"
  | "workspace_file_outside_scope"
  | "workspace_file_not_image"
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

export interface WorkspaceImageFileRead {
  root: string;
  path: string;
  relativePath: string;
  mimeType: string;
  dataBase64: string;
  byteLength: number;
}

export type WorkspaceImageFileReadResult =
  | { ok: true; file: WorkspaceImageFileRead }
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
    // Used only by the bounded full walk. Lazy FileTree mode ignores this so an
    // expanded folder's direct children are not silently omitted.
    maxEntries: number;
    // Lazy FileTree mode: descend only into these expanded folder paths and do
    // not hide/cap entries. Absent => depth-bounded full walk (Quick Open).
    expandedPaths?: string[];
    maxDepth?: number;
  }): Promise<WorkspaceFileTreeResult>;

  readTextFile(input: {
    root: string;
    path: string;
    byteLimit: number;
    // New File: when true and the file is missing, create an empty file (and parent
    // dirs) before reading. Never clobbers an existing file (spec: workbench-new-file.md).
    create?: boolean;
  }): Promise<WorkspaceFileReadResult>;

  readImageFile(input: {
    root: string;
    path: string;
    byteLimit: number;
  }): Promise<WorkspaceImageFileReadResult>;

  // Project-wide content search. It does not consult .gitignore, but the Node
  // adapter keeps the bounded source-scan heavy-dir exclusions.
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
