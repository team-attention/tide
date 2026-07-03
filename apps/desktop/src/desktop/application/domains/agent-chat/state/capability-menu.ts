import { setComposerActiveSurface } from "./composer.ts";
import { row } from "./choice-row.ts";
import { updateComposerLaunchOptions } from "./launch-options.ts";
import type {
  AgentChatChoiceSurfaceRowView,
  AgentChatProviderCapabilityOption,
  AgentChatShellState,
  AgentChatShellUpdateResult,
} from "./types.ts";
import { invokeComposerCapabilityRow } from "./capability-invocation.ts";

const CAPABILITY_GROUPS: Array<{
  group: string;
  title: string;
  meta: string;
}> = [
  { group: "session", title: "Session", meta: "Actions" },
  { group: "model", title: "Model", meta: "Config" },
  { group: "permission", title: "Permission", meta: "Config" },
  { group: "mcp", title: "MCP", meta: "Tools" },
  { group: "tools", title: "Tools", meta: "Runtime" },
  { group: "setup", title: "Setup", meta: "Provider" },
];

export function hasCapabilityMenuRows(state: AgentChatShellState): boolean {
  return visibleCapabilityMenuCapabilities(state).length > 0;
}

export function capabilityMenuRows(
  state: AgentChatShellState,
  agentLabel: string,
): AgentChatChoiceSurfaceRowView[] {
  const capabilities = visibleCapabilityMenuCapabilities(state);
  const rows: AgentChatChoiceSurfaceRowView[] = [];
  for (const group of CAPABILITY_GROUPS) {
    const grouped = capabilities.filter((capability) => capability.group === group.group);
    if (grouped.length === 0) {
      continue;
    }
    rows.push(row(`capability-section:${group.group}`, group.title, undefined, group.meta, "source", false, false, true));
    for (const capability of grouped) {
      rows.push(capabilityMenuRow(capability, agentLabel));
    }
  }
  return rows;
}

export function selectCapabilityMenuRow(
  state: AgentChatShellState,
  capabilityId: string,
  activeThreadId?: string,
): AgentChatShellUpdateResult {
  const capability = state.availableCapabilities?.find((candidate) => candidate.capabilityId === capabilityId);
  if (capability === undefined || !capability.available) {
    return setComposerActiveSurface(state, null);
  }
  switch (capability.invoke.kind) {
    case "provider_method":
      return invokeComposerCapabilityRow(state, capabilityId, activeThreadId);
    case "provider_config":
      return selectProviderConfigCapability(state, capability);
    default:
      return setComposerActiveSurface(state, null);
  }
}

function visibleCapabilityMenuCapabilities(state: AgentChatShellState): AgentChatProviderCapabilityOption[] {
  return (state.availableCapabilities ?? [])
    .filter((capability) => capability.group !== "commands" && capability.group !== "skills")
    .filter((capability) => capability.kind !== "prompt_command" && capability.kind !== "skill");
}

function capabilityMenuRow(
  capability: AgentChatProviderCapabilityOption,
  agentLabel: string,
): AgentChatChoiceSurfaceRowView {
  const selectable = capability.available && (
    capability.invoke.kind === "provider_method" ||
    capability.invoke.kind === "provider_config"
  );
  return row(
    `capability-menu:${capability.capabilityId}`,
    capability.label,
    capability.description ?? capabilityMenuDetail(capability),
    capability.available ? agentLabel : "Unavailable",
    capabilityMenuIcon(capability),
    false,
    false,
    !selectable,
  );
}

function capabilityMenuDetail(capability: AgentChatProviderCapabilityOption): string | undefined {
  if (capability.invoke.kind === "unsupported" && typeof capability.invoke.reason === "string") {
    return capability.invoke.reason;
  }
  if (capability.invoke.kind === "provider_config" && typeof capability.invoke.key === "string") {
    return capability.invoke.key === "permission" ? "Open permission controls" : "Open model controls";
  }
  return undefined;
}

function capabilityMenuIcon(capability: AgentChatProviderCapabilityOption): string | undefined {
  switch (capability.group) {
    case "session":
      return "agent";
    case "model":
      return "source";
    case "permission":
      return "tool";
    case "mcp":
    case "tools":
      return "tool";
    default:
      return undefined;
  }
}

function selectProviderConfigCapability(
  state: AgentChatShellState,
  capability: AgentChatProviderCapabilityOption,
): AgentChatShellUpdateResult {
  if (capability.invoke.kind !== "provider_config" || typeof capability.invoke.key !== "string") {
    return setComposerActiveSurface(state, null);
  }
  if (capability.invoke.value !== undefined) {
    const updated = updateComposerLaunchOptions(state, { [capability.invoke.key]: capability.invoke.value });
    return { state: { ...updated.state, composer: { ...updated.state.composer, activeSurface: null } }, command: updated.command };
  }
  if (capability.invoke.key === "permission") {
    return setComposerActiveSurface(state, "permission_menu");
  }
  const binding = state.thread?.agentBinding ?? state.composer.startOptions.agentBinding;
  return setComposerActiveSurface(
    state,
    binding.agentId === "opencode" ? "opencode_model_provider" : "model_menu",
  );
}
