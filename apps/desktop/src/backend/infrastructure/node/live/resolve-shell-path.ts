import { execFileSync } from "node:child_process";
import os from "node:os";

// A packaged macOS/Linux app launched from Finder/Dock does NOT inherit the
// user's login-shell PATH — it only gets the minimal launchd PATH
// (/usr/bin:/bin:/usr/sbin:/sbin). Provider CLIs (codex, claude, opencode) and their
// helpers live in places like ~/.local/bin, /opt/homebrew/bin, or a provider's
// own standalone bin, none of which are on that minimal PATH. `which <cli>` then
// fails, the Agent Runtime never finds an executable, and no provider ever spawns.
//
// Restore the real PATH the user's terminal sees by asking their login shell,
// then merge in common fallback bins and whatever PATH the process already had.

export interface ResolveAugmentedPathDeps {
  platform?: NodeJS.Platform;
  currentPath?: string;
  shell?: string;
  homeDir?: string;
  /** Returns the user's `$PATH` from a login shell. Injected for tests. */
  runShell?: (shell: string) => string;
}

export interface ResolveAugmentedEnvironmentDeps {
  platform?: NodeJS.Platform;
  currentEnv?: NodeJS.ProcessEnv;
  shell?: string;
  homeDir?: string;
  cwd?: string;
  /** Returns the user's full environment from a shell startup mode. Injected for tests. */
  runShellEnv?: (
    shell: string,
    mode: ShellEnvMode,
    cwd: string | undefined,
    env: NodeJS.ProcessEnv,
  ) => Record<string, string>;
}

export type ShellEnvMode = "interactive_login" | "login";

const DARWIN_FALLBACK_DIRS = ["/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin"];
const LINUX_FALLBACK_DIRS = ["/usr/local/bin"];

export function resolveAugmentedPath(deps: ResolveAugmentedPathDeps = {}): string {
  const platform = deps.platform ?? process.platform;
  const currentPath = deps.currentPath ?? process.env.PATH ?? "";
  if (platform === "win32") {
    return currentPath;
  }

  const homeDir = deps.homeDir ?? os.homedir();
  const shell = deps.shell ?? process.env.SHELL ?? "/bin/zsh";
  const runShell = deps.runShell ?? defaultRunShell;

  let shellPath = "";
  try {
    shellPath = runShell(shell).trim();
  } catch {
    shellPath = "";
  }

  return mergePathEntries({
    platform,
    homeDir,
    shellPath,
    currentPath,
  });
}

export function resolveAugmentedEnvironment(
  deps: ResolveAugmentedEnvironmentDeps = {},
): NodeJS.ProcessEnv {
  const platform = deps.platform ?? process.platform;
  const currentEnv = deps.currentEnv ?? process.env;
  if (platform === "win32") {
    return { ...currentEnv };
  }

  const homeDir = deps.homeDir ?? currentEnv.HOME ?? os.homedir();
  const shell = deps.shell ?? currentEnv.SHELL ?? "/bin/zsh";
  const cwd = deps.cwd;
  const runShellEnv = deps.runShellEnv ?? defaultRunShellEnv;

  let shellEnv: Record<string, string> = {};
  try {
    shellEnv = runShellEnv(shell, "interactive_login", cwd, currentEnv);
  } catch {
    try {
      shellEnv = runShellEnv(shell, "login", cwd, currentEnv);
    } catch {
      shellEnv = {};
    }
  }

  const result: NodeJS.ProcessEnv = { ...currentEnv };
  for (const [key, value] of Object.entries(shellEnv)) {
    if (value.length === 0 || !shouldImportShellEnv(key)) {
      continue;
    }
    result[key] = value;
  }

  result.PATH = mergePathEntries({
    platform,
    homeDir,
    shellPath: shellEnv.PATH ?? "",
    currentPath: currentEnv.PATH ?? "",
  });
  return result;
}

function mergePathEntries(input: {
  platform: NodeJS.Platform;
  homeDir: string;
  shellPath: string;
  currentPath: string;
}): string {
  const fallbackDirs = [
    `${input.homeDir}/.local/bin`,
    ...(input.platform === "darwin" ? DARWIN_FALLBACK_DIRS : LINUX_FALLBACK_DIRS),
  ];

  const merged = [
    ...input.shellPath.split(":"),
    ...fallbackDirs,
    ...input.currentPath.split(":"),
  ].filter((entry) => entry.length > 0 && !isV1WrapperBinDir(entry));

  return Array.from(new Set(merged)).join(":");
}

// The v1 "Tide Terminal" (Rust) app ships wrapper scripts for codex/claude in
// its bundle (…/crates/tide-app/resources/bin). When both products are installed
// that dir is on the login-shell PATH, so v2 would resolve its agents to v1's
// wrappers instead of the real CLIs — they are SEPARATE products and must never
// share a runtime wrapper. Drop the v1 wrapper dir so v2 always runs the real CLI.
function isV1WrapperBinDir(entry: string): boolean {
  return entry.replace(/\/+$/, "").endsWith("/crates/tide-app/resources/bin");
}

const PATH_MARKER = "__TIDE_PATH__";
const ENV_MARKER = "__TIDE_ENV__";

function defaultRunShell(shell: string): string {
  // Use a LOGIN (-l) but NON-interactive shell — NOT interactive (-i). PATH is set in
  // the login files (.zprofile/.zshenv/.profile), which -l sources. Adding -i sources
  // the interactive rc (.zshrc), whose plugins/prompt frameworks can take tens of
  // seconds on some setups; that ran on every backend start and blocked startup past
  // the parent's handshake timeout, so the app hung "can't load sessions" forever. A
  // child the slow rc spawns can also hold the pipe open past `timeout`, so the only
  // reliable fix is to not source the interactive rc at all. The login PATH already
  // contains the agent CLIs (~/.local/bin, /opt/homebrew/bin, …).
  const output = execFileSync(
    shell,
    ["-lc", `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`],
    { encoding: "utf8", timeout: 4000, stdio: ["ignore", "pipe", "ignore"] },
  );
  const match = output.match(new RegExp(`${PATH_MARKER}([\\s\\S]*)${PATH_MARKER}`));
  return match ? match[1] : "";
}

function defaultRunShellEnv(
  shell: string,
  mode: ShellEnvMode,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv,
): Record<string, string> {
  // Provider runtimes should see the same auth/tool env as `codex`, `claude`,
  // etc. launched by the user's normal terminal. Many users export those values
  // from interactive rc files (.zshrc, asdf/mise/nvm/direnv hooks), so try an
  // interactive login shell first. Keep the timeout short and fall back to a
  // non-interactive login shell because prompt/plugin startup can block.
  const shellFlag = mode === "interactive_login" ? "-lic" : "-lc";
  const output = execFileSync(
    shell,
    [shellFlag, shellEnvSnapshotCommand(shell)],
    { cwd, encoding: "utf8", env, timeout: 3000, stdio: ["ignore", "pipe", "ignore"] },
  );
  const match = output.match(new RegExp(`${ENV_MARKER}([\\s\\S]*)${ENV_MARKER}`));
  return match ? parseNullSeparatedEnv(match[1]) : {};
}

function shellEnvSnapshotCommand(shell: string): string {
  const shellName = shell.split("/").pop() ?? "";
  const direnvShell = shellName === "zsh" ? "zsh" : shellName === "fish" ? undefined : "bash";
  const direnvPrefix =
    direnvShell === undefined
      ? ""
      : `if command -v direnv >/dev/null 2>&1; then eval "$(direnv export ${direnvShell} 2>/dev/null)" || true; fi; `;
  return `${direnvPrefix}printf '${ENV_MARKER}'; /usr/bin/env -0; printf '${ENV_MARKER}'`;
}

function parseNullSeparatedEnv(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of value.split("\0")) {
    if (entry.length === 0) {
      continue;
    }
    const equalsIndex = entry.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }
    const key = entry.slice(0, equalsIndex);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      continue;
    }
    env[key] = entry.slice(equalsIndex + 1);
  }
  return env;
}

function shouldImportShellEnv(key: string): boolean {
  if (key === "PATH") {
    return false;
  }
  return !isProcessInternalShellEnv(key);
}

function isProcessInternalShellEnv(key: string): boolean {
  if (key.startsWith("TIDE_") || key.startsWith("ELECTRON_")) {
    return true;
  }
  return (
    key === "_" ||
    key === "PWD" ||
    key === "OLDPWD" ||
    key === "SHLVL" ||
    key === "PPID" ||
    key.startsWith("BASH_FUNC_")
  );
}
