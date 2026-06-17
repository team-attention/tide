import { spawnSync } from "node:child_process";

import type { ProviderSetupSurfaceAction } from "../../../../application/ports/outbound/agent-integration-port.ts";
// Provider CLI executable knowledge (audit A5/5.2): owned by the agent
// integrations, consumed by infrastructure when spawning runtimes.

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
