import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";

import type { ProviderSetupSurfaceAction } from "../../../../application/ports/outbound/agent-integration-port.ts";
// Provider CLI executable knowledge (audit A5/5.2): owned by the agent
// integrations, consumed by infrastructure when spawning runtimes.

const execFileAsync = promisify(execFile);

export // Extracted from live-backend.ts (spec: navigable-source-structure).

// Provider CLI command names: pure registry data, the only place infrastructure
// may know a provider-specific value.
const providerCliCommands = {
  codex: "codex",
  claude: "claude",
  gemini: "gemini",
  opencode: "opencode",
} as const;

export function executableForAgent(
  agentId: "codex" | "claude" | "gemini" | "opencode",
): string {
  return providerCliCommands[agentId];
}

// The npm package that provides each provider CLI (verified live 2026-06-17 via
// `npm view`). Registry data beside the executable names — the install counterpart
// of executableForAgent, used to build the install Setup Surface for a missing CLI.
const providerInstallPackages = {
  codex: "@openai/codex",
  claude: "@anthropic-ai/claude-code",
  gemini: "@google/gemini-cli",
  opencode: "opencode-ai",
} as const;

export function installPackageForAgent(
  agentId: "codex" | "claude" | "gemini" | "opencode",
): string {
  return providerInstallPackages[agentId];
}

// Build the Provider Setup Surface action that installs a missing provider CLI:
// `npm install -g <package>` in the visible terminal, re-running preflight on exit
// so readiness advances from not_installed to the sign-in gate. `npmPath` falls back
// to "npm" so a missing npm surfaces its own PATH error in the terminal, not silently.
export function npmInstallSetupAction(input: {
  npmPath: string;
  agentId: "codex" | "claude" | "gemini" | "opencode";
  cwd: string;
}): ProviderSetupSurfaceAction {
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

// Build the Setup Surface action that updates an installed CLI in place:
// `npm install -g <package>@latest` in the visible terminal, re-running preflight
// on exit so the update advisory clears once the new version is on PATH. The
// update counterpart of npmInstallSetupAction. Spec: version-management.md.
export function npmUpdateSetupAction(input: {
  npmPath: string;
  agentId: "codex" | "claude" | "gemini" | "opencode";
  cwd: string;
}): ProviderSetupSurfaceAction {
  return {
    command: input.npmPath,
    args: ["install", "-g", `${installPackageForAgent(input.agentId)}@latest`],
    cwd: input.cwd,
    expectedCompletion: "retry_preflight",
  };
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
