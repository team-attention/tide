import type { ProviderCapability } from "../../../../application/domains/native-agent/provider-capability.ts";
import type { NativeProviderId } from "../../../../application/domains/native-agent/native-runtime-event.ts";

export interface AcpProviderProfile {
  provider: Extract<NativeProviderId, "opencode" | "qwen">;
  command: string;
  args: string[];
  displayName: string;
}

export function acpCapabilitiesFromSession(input: {
  provider: AcpProviderProfile["provider"];
  commands?: Array<{ name: string; description?: string }>;
  configOptions?: Array<{ configId: string; label?: string; values?: unknown[] }>;
  nativePayload?: unknown;
}): ProviderCapability[] {
  const commands = (input.commands ?? []).map((command) => ({
    capabilityId: `${input.provider}:command:${command.name}`,
    provider: input.provider,
    source: "live_protocol" as const,
    kind: "prompt_command" as const,
    trigger: "/" as const,
    label: command.name,
    description: command.description,
    group: "commands" as const,
    invoke: { kind: "provider_prompt_text" as const, text: `/${command.name}` },
    available: true,
    nativePayload: command,
  }));
  const config = (input.configOptions ?? []).map((option) => ({
    capabilityId: `${input.provider}:config:${option.configId}`,
    provider: input.provider,
    source: "live_protocol" as const,
    kind: option.configId === "mode" ? "permission_control" as const : "config_control" as const,
    label: option.label ?? option.configId,
    group: option.configId === "mode" ? "permission" as const : "model" as const,
    invoke: { kind: "provider_config" as const, key: option.configId },
    available: true,
    nativePayload: option,
  }));
  return [...commands, ...config];
}
