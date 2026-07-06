import type {
  AgentChatChoiceSurfaceRowView,
  AgentChatProviderCapabilityOption,
  AgentChatShellState,
} from "./types.ts";
import { row } from "./choice-row.ts";

export function commandRowsFromCapabilities(
  state: AgentChatShellState,
  trigger: "/" | "$",
  query: string,
  agentLabel: string,
): AgentChatChoiceSurfaceRowView[] {
  const capabilities = state.availableCapabilities ?? [];
  if (capabilities.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  return capabilities
    .filter((capability) => capability.trigger === trigger)
    .filter((capability) => capability.kind === "prompt_command" || capability.kind === "skill")
    .filter((capability) => query.length === 0 || capability.label.toLowerCase().includes(query))
    .filter((capability) => {
      const key = `${capability.trigger}:${capability.label.toLowerCase()}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((capability) => capabilityRow(capability, agentLabel));
}

function capabilityRow(
  capability: AgentChatProviderCapabilityOption,
  agentLabel: string,
): AgentChatChoiceSurfaceRowView {
  const token = tokenForCapability(capability);
  const invokable = token !== undefined ||
    capability.invoke.kind === "provider_method" ||
    isReviewSurfaceCapability(capability);
  const disabled = !capability.available || !invokable;
  return row(
    token === undefined ? `capability:${capability.capabilityId}` : `command:${token}`,
    `${capability.trigger ?? ""}${capability.label}`,
    capability.description ?? unavailableCapabilityDetail(capability),
    capability.available ? agentLabel : "Unavailable",
    undefined,
    false,
    false,
    disabled,
  );
}

function isReviewSurfaceCapability(capability: AgentChatProviderCapabilityOption): boolean {
  return capability.invoke.kind === "tide_surface" && capability.invoke.surface === "review";
}

function tokenForCapability(capability: AgentChatProviderCapabilityOption): string | undefined {
  return capability.invoke.kind === "provider_prompt_text" && typeof capability.invoke.text === "string"
    ? capability.invoke.text
    : undefined;
}

function unavailableCapabilityDetail(capability: AgentChatProviderCapabilityOption): string | undefined {
  return capability.invoke.kind === "unsupported" && typeof capability.invoke.reason === "string"
    ? capability.invoke.reason
    : undefined;
}
