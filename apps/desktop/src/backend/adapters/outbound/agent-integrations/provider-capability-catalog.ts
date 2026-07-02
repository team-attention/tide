import type { ProviderCapability } from "../../../application/domains/native-agent/provider-capability.ts";
import { providerCapabilitySortKey } from "../../../application/domains/native-agent/provider-capability.ts";
import type { ProviderCliAgentId } from "../../../application/domains/thread/thread.ts";
import type { ProviderCapabilityDto } from "../../../../shared/contracts/index.ts";
import type { DiscoveredCommand } from "../../../application/ports/outbound/agent-runtime-port.ts";
import type { StructuredProviderEvent } from "../agent-runtime/structured/structured-runtime-events.ts";
import { acpCapabilitiesFromSession } from "./acp/acp-provider-factory.ts";
import { claudeBaseCapabilityRegistry } from "./claude/claude-capability-registry.ts";
import { codexBaseCapabilityRegistry } from "./codex/codex-capability-registry.ts";

export function providerCapabilityCatalogFromRuntimeCommands(
  agentId: ProviderCliAgentId,
  commands: DiscoveredCommand[],
): ProviderCapability[] {
  switch (agentId) {
    case "codex":
      return [
        ...codexBaseCapabilityRegistry(),
        ...commands.map((command) => codexRuntimeCommandCapability(command)),
      ];
    case "claude":
      return claudeBaseCapabilityRegistry({ runtimeCommands: commands });
    case "opencode":
      return acpCapabilitiesFromSession({
        provider: "opencode",
        commands: commands
          .filter((command) => command.trigger === "/")
          .map((command) => ({ name: command.name, description: command.description })),
      });
  }
}

export function providerCapabilityCatalogFromProviderCapabilities(
  agentId: ProviderCliAgentId,
  event: Extract<StructuredProviderEvent, { kind: "provider_capabilities" }>,
): ProviderCapability[] {
  const capabilities: ProviderCapability[] = [];
  const agentInfo = isRecord(event.agentInfo) ? event.agentInfo : {};
  const authMethods = Array.isArray(event.authMethods) ? event.authMethods : [];
  const agentCapabilities = isRecord(event.agentCapabilities) ? event.agentCapabilities : {};
  const nativePayload = {
    ...(event.protocolVersion !== undefined ? { protocolVersion: event.protocolVersion } : {}),
    ...(Object.keys(agentInfo).length > 0 ? { agentInfo } : {}),
    ...(authMethods.length > 0 ? { authMethods } : {}),
    ...(Object.keys(agentCapabilities).length > 0 ? { agentCapabilities } : {}),
  };

  if (authMethods.length > 0) {
    capabilities.push({
      capabilityId: `${agentId}:setup:auth`,
      provider: agentId,
      source: "live_protocol",
      kind: "provider_setup",
      label: "Authentication",
      description: `${authMethods.length} auth ${authMethods.length === 1 ? "method" : "methods"}`,
      group: "setup",
      invoke: {
        kind: "tide_surface",
        surface: "provider_setup",
        payload: { section: "auth", authMethods },
      },
      nativePayload,
      available: true,
    });
  }

  const capabilityKeys = Object.keys(agentCapabilities);
  if (capabilityKeys.length > 0) {
    capabilities.push({
      capabilityId: `${agentId}:setup:capabilities`,
      provider: agentId,
      source: "live_protocol",
      kind: "provider_setup",
      label: "Runtime capabilities",
      description: `${capabilityKeys.length} capability ${capabilityKeys.length === 1 ? "group" : "groups"}`,
      group: "setup",
      invoke: {
        kind: "tide_surface",
        surface: "provider_setup",
        payload: { section: "capabilities", agentCapabilities },
      },
      nativePayload,
      available: true,
    });
  }

  if (capabilities.length === 0 && Object.keys(agentInfo).length > 0) {
    const title = stringField(agentInfo, "title") ?? stringField(agentInfo, "name") ?? "Provider";
    capabilities.push({
      capabilityId: `${agentId}:setup:agent-info`,
      provider: agentId,
      source: "live_protocol",
      kind: "provider_setup",
      label: title,
      group: "setup",
      invoke: {
        kind: "tide_surface",
        surface: "provider_setup",
        payload: { section: "agentInfo", agentInfo },
      },
      nativePayload,
      available: true,
    });
  }

  return capabilities;
}

export function mergeProviderCapabilityCatalog(
  agentId: ProviderCliAgentId,
  existing: ProviderCapability[],
  incoming: ProviderCapability[],
): ProviderCapability[] {
  const byId = new Map<string, ProviderCapability>();
  for (const capability of existing) {
    if (capability.provider === agentId) {
      byId.set(capability.capabilityId, capability);
    }
  }
  for (const capability of incoming) {
    if (capability.provider === agentId) {
      byId.set(capability.capabilityId, capability);
    }
  }
  return [...byId.values()].sort((left, right) =>
    providerCapabilitySortKey(left).localeCompare(providerCapabilitySortKey(right)),
  );
}

export function providerCapabilityToDto(capability: ProviderCapability): ProviderCapabilityDto | undefined {
  if (capability.provider !== "codex" && capability.provider !== "claude" && capability.provider !== "opencode") {
    return undefined;
  }
  return {
    capabilityId: capability.capabilityId,
    agentId: capability.provider,
    source: capability.source,
    kind: capability.kind,
    trigger: capability.trigger,
    label: capability.label,
    description: capability.description,
    group: capability.group,
    invoke: capability.invoke,
    nativePayload: capability.nativePayload,
    available: capability.available,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function providerCapabilitiesToDtos(capabilities: ProviderCapability[]): ProviderCapabilityDto[] {
  return capabilities
    .map((capability) => providerCapabilityToDto(capability))
    .filter((capability): capability is ProviderCapabilityDto => capability !== undefined);
}

function codexRuntimeCommandCapability(command: DiscoveredCommand): ProviderCapability {
  return {
    capabilityId: `codex:${command.trigger}:${command.name}`,
    provider: "codex",
    source: "live_protocol",
    kind: command.trigger === "$" ? "skill" : "prompt_command",
    trigger: command.trigger,
    label: command.name,
    description: command.description,
    group: command.trigger === "$" ? "skills" : "commands",
    invoke: {
      kind: "unsupported",
      reason: "Codex runtime command invocation needs explicit app-server method or prompt metadata evidence.",
    },
    nativePayload: command,
    available: false,
  };
}
