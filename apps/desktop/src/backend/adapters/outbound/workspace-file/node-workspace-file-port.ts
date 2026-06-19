import { mkdir, open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { worktreeRepoRootForCwd } from "../../../../shared/worktree/path.ts";
import type {
  WorkspaceFileEditResult,
  WorkspaceFileError,
  WorkspaceFilePort,
  WorkspaceFileReadResult,
  WorkspaceFileSearchMatch,
  WorkspaceFileSearchResult,
  WorkspaceFileTreeEntry,
  WorkspaceFileTreeResult,
  WorkspaceFileWriteResult,
} from "../../../application/ports/outbound/workspace-file-port.ts";

const DEFAULT_TEXT_DECODER = new TextDecoder("utf-8", { fatal: false });
const MAX_EDIT_BYTES = 1024 * 1024;
const MAX_TREE_DEPTH = 12;
const MAX_TREE_ENTRIES = 4000;
// Heavy vendor/build/VCS directories are hidden from the FileTree entirely —
// they are neither listed nor descended into, so the tree stays source-focused.
// This is the ONLY exclusion: gitignored and dot/hidden files ARE shown (the
// tree no longer consults .gitignore), so config/env/scratch files are reachable.
//
// The set must cover every ecosystem's machine-generated heavy dir, not just JS:
// the walk is depth-first under a bounded entry budget, so a single un-excluded
// giant dir (e.g. a pnpm store with ~18k entries, or a Python .venv) would be
// descended into first and exhaust the whole budget, starving every sibling and
// root file that sorts after it — leaving the tree showing only the dirs visited
// before the blowout. Keep this list current with new package/build/cache dirs.
const IGNORED_DIRECTORIES = new Set([
  ".cache",
  ".git",
  ".gradle",
  ".hg",
  ".mypy_cache",
  ".next",
  ".pnpm-store",
  ".pytest_cache",
  ".ruff_cache",
  ".svn",
  ".turbo",
  ".venv",
  ".yarn",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

export function createNodeWorkspaceFilePort(): WorkspaceFilePort {
  return new NodeWorkspaceFilePort();
}

class NodeWorkspaceFilePort implements WorkspaceFilePort {
  async listTree(input: {
    root: string;
    maxEntries: number;
    // Lazy mode: descend ONLY into folders whose relativePath is in this set — a
    // collapsed folder is listed as one entry and never walked, so a huge dir the
    // user has not expanded can't starve the listing. Present (even empty) selects
    // lazy mode. Absent falls back to the depth-bounded full walk (Quick Open).
    expandedPaths?: string[];
    maxDepth?: number;
  }): Promise<WorkspaceFileTreeResult> {
    const root = path.resolve(input.root);
    let rootStat;
    try {
      rootStat = await stat(root);
    } catch {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_found",
          message: "Thread root was not found.",
        },
      };
    }

    if (!rootStat.isDirectory()) {
      return {
        ok: false,
        error: {
          code: "workspace_file_unreadable",
          message: "Thread root is not a directory.",
        },
      };
    }

    const entries: WorkspaceFileTreeEntry[] = [];
    const expandedSet =
      input.expandedPaths === undefined ? null : new Set(input.expandedPaths);
    const maxDepth = boundedTreeDepth(input.maxDepth);
    const maxEntries = boundedTreeEntries(input.maxEntries);
    let truncated = false;

    const visit = async (directory: string, depth: number): Promise<void> => {
      let children;
      try {
        children = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }

      const sorted = children.sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

      for (const child of sorted) {
        const isDir = child.isDirectory();
        if (isDir && IGNORED_DIRECTORIES.has(child.name)) {
          continue;
        }
        const childPath = path.join(directory, child.name);
        const relativePath = path.relative(root, childPath);
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }

        const kind = isDir ? "folder" : "file";
        entries.push({
          id: relativePath,
          name: child.name,
          relativePath,
          depth,
          kind,
        });

        // Lazy mode descends only into expanded folders; full mode (Quick Open)
        // descends by depth. A collapsed folder is listed but not walked.
        const descend =
          expandedSet === null
            ? depth < maxDepth
            : expandedSet.has(relativePath);
        if (kind === "folder" && descend) {
          await visit(childPath, depth + 1);
          if (truncated) {
            return;
          }
        }
      }
    };

    await visit(root, 0);

    return {
      ok: true,
      fileTree: {
        root,
        cwdLabel: path.basename(root) || root,
        revision: `tree:${Date.now()}`,
        updatedAt: new Date().toISOString(),
        entries,
        truncated,
      },
    };
  }

  async searchContent(input: {
    root: string;
    query: string;
    maxResults: number;
    maxFiles: number;
  }): Promise<WorkspaceFileSearchResult> {
    const root = path.resolve(input.root);
    const query = input.query;
    if (query.trim().length === 0) {
      return { ok: true, search: { query, matches: [], fileCount: 0, truncated: false } };
    }
    let rootStat;
    try {
      rootStat = await stat(root);
    } catch {
      return { ok: false, error: { code: "workspace_file_not_found", message: "Thread root was not found." } };
    }
    if (!rootStat.isDirectory()) {
      return { ok: false, error: { code: "workspace_file_unreadable", message: "Thread root is not a directory." } };
    }

    const needle = query.toLowerCase();
    const matches: WorkspaceFileSearchMatch[] = [];
    let fileCount = 0;
    let truncated = false;

    const visit = async (directory: string): Promise<void> => {
      if (truncated) {
        return;
      }
      let children;
      try {
        children = await readdir(directory, { withFileTypes: true });
      } catch {
        return;
      }
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        if (truncated) {
          return;
        }
        const isDir = child.isDirectory();
        if (isDir && IGNORED_DIRECTORIES.has(child.name)) {
          continue;
        }
        const childPath = path.join(directory, child.name);
        const relativePath = path.relative(root, childPath);
        if (isDir) {
          await visit(childPath);
          continue;
        }
        if (fileCount >= input.maxFiles) {
          truncated = true;
          return;
        }
        let buffer: Buffer;
        try {
          buffer = await readFile(childPath);
        } catch {
          continue;
        }
        // Skip binary files (NUL byte in the first chunk) and very large files.
        if (buffer.length > 2 * 1024 * 1024 || buffer.subarray(0, 8000).includes(0)) {
          continue;
        }
        fileCount += 1;
        const text = DEFAULT_TEXT_DECODER.decode(buffer);
        const lines = text.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const column = lines[i].toLowerCase().indexOf(needle);
          if (column === -1) {
            continue;
          }
          matches.push({
            relativePath,
            line: i,
            column,
            lineText: lines[i].length > 400 ? `${lines[i].slice(0, 400)}…` : lines[i],
          });
          if (matches.length >= input.maxResults) {
            truncated = true;
            return;
          }
        }
      }
    };

    await visit(root);
    return { ok: true, search: { query, matches, fileCount, truncated } };
  }

  async readTextFile(input: {
    root: string;
    path: string;
    byteLimit: number;
    create?: boolean;
  }): Promise<WorkspaceFileReadResult> {
    const resolved = resolveInsideRoot(input.root, input.path);
    if (!resolved.ok) {
      return resolved;
    }

    // New File: create an empty file (and any missing parent dirs) if asked and it is
    // absent. `wx` makes this atomic create-if-missing — an existing file is left
    // untouched (EEXIST is the expected "already there" case, swallowed).
    if (input.create === true) {
      try {
        await mkdir(path.dirname(resolved.path), { recursive: true });
        await writeFile(resolved.path, "", { flag: "wx" });
      } catch (error) {
        if (!isErrnoException(error, "EEXIST")) {
          return {
            ok: false,
            error: { code: "workspace_file_unreadable", message: "Could not create the file." },
          };
        }
      }
    }

    let fileStat;
    try {
      fileStat = await stat(resolved.path);
    } catch {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_found",
          message: "File was not found.",
        },
      };
    }

    if (!fileStat.isFile()) {
      return {
        ok: false,
        error: {
          code: "workspace_file_unreadable",
          message: "Path is not a regular file.",
        },
      };
    }

    const bytesToRead = Math.max(0, Math.min(input.byteLimit, fileStat.size));
    const buffer = Buffer.alloc(bytesToRead);
    const handle = await open(resolved.path, "r");
    try {
      await handle.read(buffer, 0, bytesToRead, 0);
    } finally {
      await handle.close();
    }

    if (buffer.includes(0)) {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_text",
          message: "File appears to be binary and cannot be rendered as text.",
        },
      };
    }

    return {
      ok: true,
      file: {
        root: resolved.root,
        path: resolved.path,
        relativePath: resolved.relativePath,
        content: DEFAULT_TEXT_DECODER.decode(buffer),
        byteLength: fileStat.size,
        truncated: fileStat.size > bytesToRead,
      },
    };
  }

  async replaceText(input: {
    root: string;
    path: string;
    oldText: string;
    newText: string;
    expectedOccurrences: number;
    byteLimit: number;
  }): Promise<WorkspaceFileEditResult> {
    const resolved = resolveInsideRoot(input.root, input.path);
    if (!resolved.ok) {
      return resolved;
    }

    let fileStat;
    try {
      fileStat = await stat(resolved.path);
    } catch {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_found",
          message: "File was not found.",
        },
      };
    }

    if (!fileStat.isFile()) {
      return {
        ok: false,
        error: {
          code: "workspace_file_unreadable",
          message: "Path is not a regular file.",
        },
      };
    }
    if (fileStat.size > MAX_EDIT_BYTES) {
      return {
        ok: false,
        error: {
          code: "workspace_file_too_large",
          message: "File is too large for bounded exact replacement.",
        },
      };
    }

    const beforeBuffer = await readFile(resolved.path);
    if (beforeBuffer.includes(0)) {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_text",
          message: "File appears to be binary and cannot be edited as text.",
        },
      };
    }

    const before = DEFAULT_TEXT_DECODER.decode(beforeBuffer);
    const replacementCount = occurrencesOf(before, input.oldText);
    if (
      input.oldText.length === 0 ||
      replacementCount !== input.expectedOccurrences
    ) {
      return {
        ok: false,
        error: {
          code: "workspace_file_edit_conflict",
          message: "File edit did not match the expected text.",
        },
      };
    }

    const after = before.split(input.oldText).join(input.newText);
    await writeFile(resolved.path, after, "utf8");

    return {
      ok: true,
      file: {
        root: resolved.root,
        path: resolved.path,
        relativePath: resolved.relativePath,
        replacementCount,
        beforeByteLength: beforeBuffer.length,
        afterByteLength: Buffer.byteLength(after),
        beforeContent: before,
        afterContent: after.slice(0, Math.max(0, input.byteLimit)),
        truncated: Buffer.byteLength(after) > Math.max(0, input.byteLimit),
      },
    };
  }

  async writeTextFile(input: {
    root: string;
    path: string;
    content: string;
    byteLimit: number;
  }): Promise<WorkspaceFileWriteResult> {
    const resolved = resolveInsideRoot(input.root, input.path);
    if (!resolved.ok) {
      return resolved;
    }

    let fileStat;
    try {
      fileStat = await stat(resolved.path);
    } catch {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_found",
          message: "File was not found.",
        },
      };
    }

    if (!fileStat.isFile()) {
      return {
        ok: false,
        error: {
          code: "workspace_file_unreadable",
          message: "Path is not a regular file.",
        },
      };
    }
    if (Buffer.byteLength(input.content) > MAX_EDIT_BYTES) {
      return {
        ok: false,
        error: {
          code: "workspace_file_too_large",
          message: "File is too large for bounded Editor Pane save.",
        },
      };
    }

    const beforeBuffer = await readFile(resolved.path);
    if (beforeBuffer.includes(0)) {
      return {
        ok: false,
        error: {
          code: "workspace_file_not_text",
          message: "File appears to be binary and cannot be edited as text.",
        },
      };
    }

    await writeFile(resolved.path, input.content, "utf8");
    const byteLength = Buffer.byteLength(input.content);
    const preview = input.content.slice(0, Math.max(0, input.byteLimit));

    return {
      ok: true,
      file: {
        root: resolved.root,
        path: resolved.path,
        relativePath: resolved.relativePath,
        content: preview,
        byteLength,
        truncated: byteLength > Math.max(0, input.byteLimit),
      },
    };
  }
}

function isErrnoException(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === code
  );
}

function boundedTreeDepth(value: number | undefined): number {
  if (value !== undefined && Number.isInteger(value) && value >= 0) {
    return Math.min(value, MAX_TREE_DEPTH);
  }
  return 2;
}

function boundedTreeEntries(value: number): number {
  if (Number.isInteger(value) && value > 0) {
    return Math.min(value, MAX_TREE_ENTRIES);
  }
  return 160;
}

function occurrencesOf(value: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }
  return value.split(needle).length - 1;
}

function resolveInsideRoot(
  rootInput: string,
  fileInput: string,
):
  | { ok: true; root: string; path: string; relativePath: string }
  | { ok: false; error: WorkspaceFileError } {
  const root = path.resolve(rootInput);
  const directCandidate = path.isAbsolute(fileInput)
    ? path.resolve(fileInput)
    : path.resolve(root, fileInput);
  const candidate = candidateInsideRoot(root, directCandidate)
    ? directCandidate
    : remapRepoPathIntoDefaultWorktree(root, directCandidate) ?? directCandidate;

  if (!candidateInsideRoot(root, candidate)) {
    return {
      ok: false,
      error: {
        code: "workspace_file_outside_scope",
        message: "File path is outside the Thread root.",
      },
    };
  }

  return {
    ok: true,
    root,
    path: candidate,
    relativePath: path.relative(root, candidate) || ".",
  };
}

function candidateInsideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function remapRepoPathIntoDefaultWorktree(root: string, candidate: string): string | null {
  const repoRoot = worktreeRepoRootForCwd(root);
  if (repoRoot === null) {
    return null;
  }
  const repo = path.resolve(repoRoot);
  if (!candidateInsideRoot(repo, candidate)) {
    return null;
  }
  const relativePath = path.relative(repo, candidate);
  return path.resolve(root, relativePath);
}
