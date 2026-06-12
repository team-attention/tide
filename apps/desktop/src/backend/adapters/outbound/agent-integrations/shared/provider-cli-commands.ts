import { spawnSync } from "node:child_process";
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
