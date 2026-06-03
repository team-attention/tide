import { open, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceFileEditResult,
  WorkspaceFileError,
  WorkspaceFilePort,
  WorkspaceFileReadResult,
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
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

export function createNodeWorkspaceFilePort(): WorkspaceFilePort {
  return new NodeWorkspaceFilePort();
}

class NodeWorkspaceFilePort implements WorkspaceFilePort {
  async listTree(input: {
    root: string;
    maxDepth: number;
    maxEntries: number;
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
    const maxDepth = boundedTreeDepth(input.maxDepth);
    const maxEntries = boundedTreeEntries(input.maxEntries);
    const ignoredByGit = await loadGitignoreMatcher(root);
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
        if (ignoredByGit(relativePath, child.name, isDir)) {
          continue;
        }
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

        if (kind === "folder" && depth < maxDepth) {
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

  async readTextFile(input: {
    root: string;
    path: string;
    byteLimit: number;
  }): Promise<WorkspaceFileReadResult> {
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

function boundedTreeDepth(value: number): number {
  if (Number.isInteger(value) && value >= 0) {
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

type GitignoreMatcher = (relativePath: string, name: string, isDir: boolean) => boolean;

interface GitignoreRule {
  regex: RegExp;
  dirOnly: boolean;
  // Anchored/path rules match the full relativePath; basename rules match `name`.
  matchPath: boolean;
}

// Reads the thread root `.gitignore` and returns a conservative matcher for the
// common pattern subset (see spec D7). Negation and nested .gitignore are out of
// scope; unknown patterns are skipped so a wanted file is never hidden by mistake.
async function loadGitignoreMatcher(root: string): Promise<GitignoreMatcher> {
  let text: string;
  try {
    text = await readFile(path.join(root, ".gitignore"), "utf8");
  } catch {
    return () => false;
  }

  const rules: GitignoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#") || line.startsWith("!")) {
      continue;
    }
    const dirOnly = line.endsWith("/");
    let pattern = dirOnly ? line.slice(0, -1) : line;
    const anchored = pattern.startsWith("/");
    if (anchored) {
      pattern = pattern.slice(1);
    }
    if (pattern.length === 0) {
      continue;
    }
    const matchPath = anchored || pattern.includes("/");
    const regex = gitignoreGlobToRegExp(pattern);
    if (regex === null) {
      continue;
    }
    rules.push({ regex, dirOnly, matchPath });
  }

  if (rules.length === 0) {
    return () => false;
  }

  return (relativePath, name, isDir) => {
    const normalized = relativePath.split(path.sep).join("/");
    for (const rule of rules) {
      if (rule.dirOnly && !isDir) {
        continue;
      }
      const target = rule.matchPath ? normalized : name;
      if (rule.regex.test(target)) {
        return true;
      }
    }
    return false;
  };
}

// Converts a gitignore glob (supporting `*`, `**`, and literal text) into an
// anchored RegExp. Returns null for unsupported syntax (`?`, char classes) so the
// caller skips the rule rather than risk an incorrect match.
function gitignoreGlobToRegExp(pattern: string): RegExp | null {
  if (pattern.includes("?") || pattern.includes("[") || pattern.includes("]")) {
    return null;
  }
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i += 1;
      } else {
        out += "[^/]*";
      }
    } else if (/[a-zA-Z0-9_\- /]/.test(char)) {
      out += char;
    } else {
      out += `\\${char}`;
    }
  }
  return new RegExp(`^${out}$`);
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
  const candidate = path.isAbsolute(fileInput)
    ? path.resolve(fileInput)
    : path.resolve(root, fileInput);

  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) {
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
