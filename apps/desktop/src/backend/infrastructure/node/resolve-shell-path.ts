import { execFileSync } from "node:child_process";
import os from "node:os";

// A packaged macOS/Linux app launched from Finder/Dock does NOT inherit the
// user's login-shell PATH — it only gets the minimal launchd PATH
// (/usr/bin:/bin:/usr/sbin:/sbin). Provider CLIs (codex, claude, gemini) and their
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

  const fallbackDirs = [
    `${homeDir}/.local/bin`,
    ...(platform === "darwin" ? DARWIN_FALLBACK_DIRS : LINUX_FALLBACK_DIRS),
  ];

  const merged = [
    ...shellPath.split(":"),
    ...fallbackDirs,
    ...currentPath.split(":"),
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
