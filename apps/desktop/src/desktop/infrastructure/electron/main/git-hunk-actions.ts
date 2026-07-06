import { execFile } from "node:child_process";

export type GitActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type GitHunkAction = "stage" | "unstage" | "discard";

const invalidGitAction: GitActionResult = { ok: false, message: "Invalid git action." };
const MAX_HUNK_PATCH_BYTES = 512 * 1024;

export async function applyGitHunk(input: {
  cwd: unknown;
  relPath: unknown;
  patch: unknown;
  action: unknown;
}): Promise<GitActionResult> {
  const root = await gitActionRoot(input.cwd);
  const path = safeGitRelativePath(input.relPath);
  const patch = typeof input.patch === "string" ? input.patch : "";
  const action = gitHunkAction(input.action);
  if (
    root === null ||
    path === null ||
    action === null ||
    patch.length === 0 ||
    Buffer.byteLength(patch, "utf8") > MAX_HUNK_PATCH_BYTES ||
    !patchTargetsPath(patch, path)
  ) {
    return invalidGitAction;
  }

  const args = hunkApplyArgs(root, action);
  const result = await execGitWithStdin(args, patch);
  return gitActionMessage(result, hunkActionFallback(action, path));
}

async function gitActionRoot(cwd: unknown): Promise<string | null> {
  if (typeof cwd !== "string" || cwd.length === 0) {
    return null;
  }
  const inside = (await execGitStdout(["-C", cwd, "rev-parse", "--is-inside-work-tree"])).trim();
  if (inside !== "true") {
    return null;
  }
  return (await execGitStdout(["-C", cwd, "rev-parse", "--show-toplevel"])).trim() || cwd;
}

function safeGitRelativePath(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && !value.startsWith("/") && !value.includes("..")
    ? value
    : null;
}

function gitHunkAction(value: unknown): GitHunkAction | null {
  return value === "stage" || value === "unstage" || value === "discard" ? value : null;
}

function hunkApplyArgs(root: string, action: GitHunkAction): string[] {
  const base = ["-C", root, "apply", "--whitespace=nowarn"];
  switch (action) {
    case "stage":
      return [...base, "--cached", "-"];
    case "unstage":
      return [...base, "--cached", "--reverse", "-"];
    case "discard":
      return [...base, "--reverse", "-"];
  }
}

function patchTargetsPath(patch: string, relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/");
  const lines = patch.split("\n");
  const diffLines = lines.filter((line) => line.startsWith("diff --git "));
  if (diffLines.length > 1) {
    return false;
  }
  if (diffLines.length === 1 && !diffLineTargetsPath(diffLines[0], normalized)) {
    return false;
  }
  return lines.some((line) => {
    const path = patchHeaderPath(line);
    return path !== null && gitPathMatches(path, normalized);
  });
}

function diffLineTargetsPath(line: string, normalizedPath: string): boolean {
  const quotedPaths = quotedGitPaths(line.slice("diff --git ".length));
  if (quotedPaths.length > 0) {
    return quotedPaths.some((path) => gitPathMatches(path, normalizedPath));
  }
  return line.includes(` a/${normalizedPath}`) || line.includes(` b/${normalizedPath}`);
}

function patchHeaderPath(line: string): string | null {
  if (!line.startsWith("--- ") && !line.startsWith("+++ ")) {
    return null;
  }
  const text = line.slice(4).trimEnd();
  if (text.startsWith("\"")) {
    return quotedGitPaths(text)[0] ?? null;
  }
  return text.split("\t", 1)[0] ?? null;
}

function quotedGitPaths(text: string): string[] {
  return Array.from(text.matchAll(/"((?:\\.|[^"\\])*)"/g), (match) => decodeGitQuotedPath(match[1] ?? ""));
}

function decodeGitQuotedPath(value: string): string {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\") {
      const octal = /^[0-7]{1,3}/.exec(value.slice(index + 1))?.[0];
      if (octal !== undefined) {
        bytes.push(parseInt(octal, 8));
        index += octal.length;
      } else {
        pushUtf8(bytes, escapedGitPathChar(value[index + 1] ?? ""));
        index += 1;
      }
    } else {
      pushUtf8(bytes, value[index] ?? "");
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function escapedGitPathChar(value: string): string {
  return ({ a: "\x07", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v" } as Record<string, string>)[value] ?? value;
}

function pushUtf8(bytes: number[], value: string): void {
  bytes.push(...Buffer.from(value, "utf8"));
}

function gitPathMatches(path: string, normalizedPath: string): boolean {
  const normalizedGitPath = path.replace(/\\/g, "/");
  return (
    normalizedGitPath === normalizedPath ||
    normalizedGitPath === `a/${normalizedPath}` ||
    normalizedGitPath === `b/${normalizedPath}`
  );
}

function execGitWithStdin(args: string[], stdin: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile("git", args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ ok: error === null, stdout: stdout ?? "", stderr: stderr ?? "" });
    });
    child.stdin?.end(stdin);
  });
}

function execGitStdout(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile("git", args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve(error === null ? stdout ?? "" : "");
    });
  });
}

function gitActionMessage(result: { ok: boolean; stdout: string; stderr: string }, fallback: string): GitActionResult {
  if (result.ok) {
    return { ok: true, message: result.stdout.trim() || fallback };
  }
  return { ok: false, message: result.stderr.trim() || "Git hunk action failed." };
}

function hunkActionFallback(action: GitHunkAction, path: string): string {
  switch (action) {
    case "stage":
      return `Staged hunk in ${path}.`;
    case "unstage":
      return `Unstaged hunk in ${path}.`;
    case "discard":
      return `Discarded hunk in ${path}.`;
  }
}
