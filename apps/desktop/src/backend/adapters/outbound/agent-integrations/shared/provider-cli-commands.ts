import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import type { ProviderReadinessTerminalAction } from "../../../../application/ports/outbound/agent-integration-port.ts";
// Provider CLI executable knowledge (audit A5/5.2): owned by the agent
// integrations, consumed by infrastructure when spawning runtimes.

const execFileAsync = promisify(execFile);

export // Extracted from live-backend.ts (spec: navigable-source-structure).

// Provider CLI command names: pure registry data, the only place infrastructure
// may know a provider-specific value.
const providerCliCommands = {
  codex: "codex",
  claude: "claude",
  opencode: "opencode",
} as const;

export function executableForAgent(
  agentId: "codex" | "claude" | "opencode",
): string {
  return providerCliCommands[agentId];
}

// The npm package that provides each provider CLI (verified live 2026-06-17 via
// `npm view`). Registry data beside the executable names — the install counterpart
// of executableForAgent, used to build the install readiness terminal for a missing CLI.
const providerInstallPackages = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
  opencode: "opencode-ai",
} as const;

export function installPackageForAgent(
  agentId: "codex" | "claude" | "opencode",
): string {
  return providerInstallPackages[agentId];
}

// Build the provider readiness terminal action that installs a missing provider CLI:
// `npm install -g <package>` in the visible terminal, re-running preflight on exit
// so readiness advances from not_installed to the sign-in gate. `npmPath` falls back
// to "npm" so a missing npm surfaces its own PATH error in the terminal, not silently.
export function npmInstallReadinessTerminalAction(input: {
  npmPath: string;
  agentId: "codex" | "claude" | "opencode";
  cwd: string;
}): ProviderReadinessTerminalAction {
  return {
    command: input.npmPath,
    args: ["install", "-g", installPackageForAgent(input.agentId)],
    cwd: input.cwd,
    expectedCompletion: "retry_preflight",
  };
}

export function resolveExecutable(command: string): string | undefined {
  const result = spawnSync("which", [command], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return undefined;
  }
  const resolved = result.stdout.trim();
  return resolved.length > 0 ? resolved : undefined;
}

export function updateReadinessTerminalActionForAgent(input: {
  agentId: "codex" | "claude" | "opencode";
  cwd: string;
  executablePath?: string;
  nativeUpdateAvailable?: boolean;
}): ProviderReadinessTerminalAction | undefined {
  const providerNativeUpdateArgs = providerNativeUpdateArgsForAgent(input.agentId);
  if (
    input.executablePath !== undefined &&
    providerNativeUpdateArgs !== undefined &&
    input.nativeUpdateAvailable === true
  ) {
    return {
      command: input.executablePath,
      args: providerNativeUpdateArgs,
      cwd: input.cwd,
      expectedCompletion: "retry_preflight",
    };
  }
  return undefined;
}

export async function providerNativeUpdateCommandAvailable(input: {
  executablePath: string;
  agentId: "codex" | "claude" | "opencode";
}): Promise<boolean> {
  const providerNativeUpdateArgs = providerNativeUpdateArgsForAgent(input.agentId);
  if (providerNativeUpdateArgs === undefined) {
    return false;
  }
  try {
    const { stdout, stderr } = await execFileAsync(input.executablePath, ["--help"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return helpOutputAdvertisesProviderNativeUpdate({
      agentId: input.agentId,
      helpOutput: `${stdout ?? ""}\n${stderr ?? ""}`,
    });
  } catch {
    return false;
  }
}

export function helpOutputAdvertisesProviderNativeUpdate(input: {
  agentId: "codex" | "claude" | "opencode";
  helpOutput: string;
}): boolean {
  const providerNativeUpdateArgs = providerNativeUpdateArgsForAgent(input.agentId);
  const subcommand = providerNativeUpdateArgs?.[0];
  if (subcommand === undefined) {
    return false;
  }
  return new RegExp(`\\b${escapeRegExp(subcommand)}\\b`).test(input.helpOutput);
}

export function providerNativeUpdateArgsForAgent(
  agentId: "codex" | "claude" | "opencode",
): string[] | undefined {
  if (agentId === "codex" || agentId === "claude") {
    return ["update"];
  }
  if (agentId === "opencode") {
    return ["upgrade"];
  }
  return undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The first semver-looking token in a CLI's `--version` / `npm view` output.
// CLIs print version lines in different shapes ("1.2.3", "codex-cli 0.20.0",
// "1.2.3 (Claude Code)"), so anchor on the version token, not the whole line.
function parseVersionToken(text: string): string | undefined {
  const match = text.match(/(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/);
  return match?.[1];
}

// Read the installed version of a provider CLI by running `<exe> --version`.
// ASYNC (execFile, not spawnSync): some CLIs take a few hundred ms to print their
// version, and probing all installed providers synchronously at boot (the update
// checker's startup refresh) froze the backend event loop for ~1s — stalling the
// cold-boot rail skeleton. Off the loop it never blocks. Some CLIs print the version
// to stderr, so both streams are scanned; undefined when the binary cannot spawn.
export async function providerVersionForExecutable(executablePath: string): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseVersionToken(`${stdout ?? ""}\n${stderr ?? ""}`);
  } catch {
    // Failed to spawn, exited non-zero, or timed out — no readable version.
    return undefined;
  }
}

// Read the latest published version of an npm package via `npm view <pkg>
// version`. Network I/O — async so the background update probe never blocks the
// backend event loop; undefined on any failure (offline, missing npm, timeout).
export async function latestPublishedVersion(
  pkg: string,
  npmPath: string,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(npmPath, ["view", pkg, "version"], {
      timeout: 15000,
    });
    return parseVersionToken(stdout);
  } catch {
    return undefined;
  }
}
