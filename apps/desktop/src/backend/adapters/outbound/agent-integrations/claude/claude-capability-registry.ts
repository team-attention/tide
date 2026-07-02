import type { ProviderCapability } from "../../../../application/domains/native-agent/provider-capability.ts";

export function claudeBaseCapabilityRegistry(input: {
  runtimeCommands?: Array<{ name: string; description?: string; trigger?: "/" | "$" }>;
} = {}): ProviderCapability[] {
  const liveCommands = (input.runtimeCommands ?? []).map((command) => ({
    capabilityId: `claude:${command.trigger ?? "/"}:${command.name}`,
    provider: "claude" as const,
    source: "live_protocol" as const,
    kind: command.trigger === "$" ? "skill" as const : "prompt_command" as const,
    trigger: command.trigger ?? "/",
    label: command.name,
    description: command.description,
    group: command.trigger === "$" ? "skills" as const : "commands" as const,
    invoke: { kind: "provider_prompt_text" as const, text: `${command.trigger ?? "/"}${command.name}` },
    available: true,
    nativePayload: command,
  }));

  return [
    ...liveCommands,
    configCapability("claude:model", "Model", "model"),
    configCapability("claude:effort", "Effort", "reasoning"),
    configCapability("claude:permission", "Permission mode", "permission"),
    {
      capabilityId: "claude:skills:invoke",
      provider: "claude",
      source: "manual_audit",
      kind: "skill",
      trigger: "$",
      label: "Invoke skill",
      description: "Provider-owned skill invocation; concrete send path must come from stream-json fixtures.",
      group: "skills",
      invoke: { kind: "unsupported", reason: "Skill invocation path requires stream-json fixture evidence." },
      available: false,
    },
  ];
}

function configCapability(
  capabilityId: string,
  label: string,
  key: string,
): ProviderCapability {
  return {
    capabilityId,
    provider: "claude",
    source: "cli_help",
    kind: key === "permission" ? "permission_control" : "config_control",
    label,
    group: key === "permission" ? "permission" : "model",
    invoke: { kind: "provider_config", key },
    available: true,
  };
}
