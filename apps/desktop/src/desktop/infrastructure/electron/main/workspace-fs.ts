import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

// Structural filesystem mutations for the FileTree (new file/folder, rename, move,
// trash), run in the MAIN process so trash can use Electron's `shell.trashItem`
// (unavailable in the backend utility process). Each takes an absolute workspace
// `root` plus workspace-relative path(s) from the renderer — the same shape as the
// git/worktree/reveal handlers. Path safety (no escaping the root) is enforced here.
// Spec: docs_v2/specs/workbench-filetree-file-operations.md.

export type WorkspaceFsResult =
  | { ok: true; relativePath: string }
  | { ok: false; code: WorkspaceFsErrorCode; message: string };

export type WorkspaceFsErrorCode =
  | "path_outside_root"
  | "path_is_root"
  | "not_found"
  | "file_exists"
  | "folder_exists"
  | "path_exists"
  | "invalid_move"
  | "io_error";

interface ResolvedPath {
  root: string;
  abs: string;
  relativePath: string;
}

// Resolve a workspace-relative path against the root and reject anything that
// escapes it (`..`, an absolute path elsewhere, or a sibling sharing the prefix
// like `/root-x`). Mirrors the backend port's `resolveInsideRoot`.
export function resolveInsideRoot(
  rootInput: string,
  relInput: string,
): { ok: true; resolved: ResolvedPath } | { ok: false; code: WorkspaceFsErrorCode; message: string } {
  const root = path.resolve(rootInput);
  const candidate = path.isAbsolute(relInput)
    ? path.resolve(relInput)
    : path.resolve(root, relInput);

  // Outside the root if reaching it means climbing out (`..`) or it sits on another
  // Windows drive (an absolute relative path). `path.relative` is robust where a
  // `startsWith(root + sep)` prefix check is wrong — a drive root (`C:\`) or `/`,
  // and sibling dirs sharing the prefix (`/root` vs `/root-x`).
  const relativePath = path.relative(root, candidate);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return { ok: false, code: "path_outside_root", message: "Path is outside the workspace root." };
  }
  return {
    ok: true,
    resolved: { root, abs: candidate, relativePath },
  };
}

// True when moving `fromAbs` to `toAbs` would put a folder inside itself or its own
// descendant (or is a no-op onto itself). Operates on absolute paths.
export function isInvalidMove(fromAbs: string, toAbs: string): boolean {
  if (toAbs === fromAbs) {
    return true;
  }
  return toAbs.startsWith(`${fromAbs}${path.sep}`);
}

function errno(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

// Create a new file with `content`, refusing to clobber an existing path. Parent
// directories are created as needed.
export async function createFileInWorkspace(
  root: string,
  relativePath: string,
  content: string,
): Promise<WorkspaceFsResult> {
  const resolved = resolveInsideRoot(root, relativePath);
  if (!resolved.ok) {
    return resolved;
  }
  if (resolved.resolved.relativePath === "") {
    return { ok: false, code: "path_is_root", message: "Cannot create the workspace root itself." };
  }
  try {
    await mkdir(path.dirname(resolved.resolved.abs), { recursive: true });
    await writeFile(resolved.resolved.abs, content, { flag: "wx" });
    return { ok: true, relativePath: resolved.resolved.relativePath };
  } catch (error) {
    if (errno(error) === "EEXIST") {
      return { ok: false, code: "file_exists", message: "A file or folder already exists there." };
    }
    return { ok: false, code: "io_error", message: "Could not create the file." };
  }
}

// Create a new (empty) folder, refusing to clobber an existing path.
export async function createFolderInWorkspace(
  root: string,
  relativePath: string,
): Promise<WorkspaceFsResult> {
  const resolved = resolveInsideRoot(root, relativePath);
  if (!resolved.ok) {
    return resolved;
  }
  if (resolved.resolved.relativePath === "") {
    return { ok: false, code: "path_is_root", message: "Cannot create the workspace root itself." };
  }
  if (await pathExists(resolved.resolved.abs)) {
    return { ok: false, code: "folder_exists", message: "A file or folder already exists there." };
  }
  try {
    await mkdir(resolved.resolved.abs, { recursive: true });
    return { ok: true, relativePath: resolved.resolved.relativePath };
  } catch {
    return { ok: false, code: "io_error", message: "Could not create the folder." };
  }
}

// Move/rename a path, refusing to clobber the destination or move a folder into
// itself. Covers both rename (same parent) and drag-move (new parent).
export async function moveInWorkspace(
  root: string,
  fromRel: string,
  toRel: string,
): Promise<WorkspaceFsResult> {
  const from = resolveInsideRoot(root, fromRel);
  if (!from.ok) {
    return from;
  }
  const to = resolveInsideRoot(root, toRel);
  if (!to.ok) {
    return to;
  }
  if (from.resolved.relativePath === "" || to.resolved.relativePath === "") {
    return { ok: false, code: "path_is_root", message: "Cannot move the workspace root itself." };
  }
  if (isInvalidMove(from.resolved.abs, to.resolved.abs)) {
    return { ok: false, code: "invalid_move", message: "Cannot move a folder into itself." };
  }
  if (!(await pathExists(from.resolved.abs))) {
    return { ok: false, code: "not_found", message: "The item to move no longer exists." };
  }
  if (await pathExists(to.resolved.abs)) {
    return { ok: false, code: "path_exists", message: "A file or folder already exists at the destination." };
  }
  try {
    await mkdir(path.dirname(to.resolved.abs), { recursive: true });
    await rename(from.resolved.abs, to.resolved.abs);
    return { ok: true, relativePath: to.resolved.relativePath };
  } catch {
    return { ok: false, code: "io_error", message: "Could not move the item." };
  }
}

// Send a path to the OS Trash (recoverable). The actual trash syscall is injected
// (`shell.trashItem` in production) so the logic stays testable.
export async function trashInWorkspace(
  root: string,
  relativePath: string,
  trashItem: (absolutePath: string) => Promise<void>,
): Promise<WorkspaceFsResult> {
  const resolved = resolveInsideRoot(root, relativePath);
  if (!resolved.ok) {
    return resolved;
  }
  if (resolved.resolved.relativePath === "") {
    return { ok: false, code: "path_is_root", message: "Cannot delete the workspace root itself." };
  }
  if (!(await pathExists(resolved.resolved.abs))) {
    return { ok: false, code: "not_found", message: "The item no longer exists." };
  }
  try {
    await trashItem(resolved.resolved.abs);
    return { ok: true, relativePath: resolved.resolved.relativePath };
  } catch {
    return { ok: false, code: "io_error", message: "Could not move the item to Trash." };
  }
}
