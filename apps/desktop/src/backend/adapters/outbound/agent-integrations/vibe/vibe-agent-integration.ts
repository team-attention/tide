import type { AgentIntegrationPort, AgentStartPlanInput, ProviderLaunchPlan } from "../../../../application/ports/outbound/agent-integration-port.ts";

export function vibeConfigOptions(options: Record<string, unknown> | undefined, keys: readonly string[]) {
  return keys.flatMap((key) => {
    const value = options?.[key];
    if (typeof value !== "string" || !value || value === "vibe default") return [];
    const configId = key === "reasoning" ? "thinking" : key === "permission" ? "mode" : key;
    return ["model", "thinking", "mode"].includes(configId) ? [{ configId, value }] : [];
  });
}

export function createVibeAgentIntegration(input: {
  resolveExecutable: (command: string) => string | undefined;
  defaultCwd?: string;
  tideMcp?: { command: string; args: string[]; env?: Record<string, string> };
}): AgentIntegrationPort {
  const capabilities = { supportsResume: true, supportsTideMcp: true, supportsHooks: false, supportsReadableHistory: false, supportsTurnSteer: false };
  const cwdFor = (scope: AgentStartPlanInput["scope"]) => scope ? scope.kind === "project" ? scope.cwd : scope.scratchCwd : input.defaultCwd ?? process.cwd();
  const plan = (request: AgentStartPlanInput): ProviderLaunchPlan => ({
    command: input.resolveExecutable("vibe-acp") ?? "vibe-acp", args: [], env: {}, cwd: cwdFor(request.scope), transport: "acp",
    protocolParams: {
      cwd: cwdFor(request.scope),
      configOptions: vibeConfigOptions(request.launchOptions, ["model", "reasoning", "permission"]),
      ...(input.tideMcp ? { mcpServers: [{ name: "tide", command: input.tideMcp.command, args: input.tideMcp.args,
        env: Object.entries({ ...input.tideMcp.env, TIDE_AGENT_ID: "vibe", ...(request.runtimeId ? { TIDE_RUNTIME_ID: request.runtimeId } : {}) }).map(([name, value]) => ({ name, value })),
      }] } : {}),
    },
  });
  return {
    async preflight(request) {
      const executable = input.resolveExecutable("vibe-acp");
      return { agentId: "vibe", ready: !!executable, capabilities, blockers: executable ? [] : [{
        kind: "not_installed", scope: "provider", message: "Mistral Vibe was not found. Install mistral-vibe and sign in with vibe.",
        terminalAction: { command: "uv", args: ["tool", "install", "mistral-vibe"], cwd: cwdFor(request.scope), expectedCompletion: "retry_preflight" },
      }] };
    },
    async buildStartPlan(request) { return plan(request); },
    async buildResumePlan(request) { return plan(request); },
    buildSessionConfigUpdate(request) { return { kind: "live", protocolParams: { configOptions: vibeConfigOptions(request.launchOptions, request.changedKeys) } }; },
  };
}
