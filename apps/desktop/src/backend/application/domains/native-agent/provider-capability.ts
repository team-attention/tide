import type { NativeProviderId } from "./native-runtime-event.ts";

export type ProviderCapabilityKind =
  | "prompt_command"
  | "skill"
  | "session_action"
  | "config_control"
  | "permission_control"
  | "mcp_surface"
  | "tool_surface"
  | "provider_setup";

export type ProviderCapabilityInvoke =
  | { kind: "provider_method"; method: string; params?: unknown }
  | { kind: "provider_prompt_text"; text: string }
  | { kind: "provider_structured_prompt_metadata"; metadata: unknown }
  | { kind: "provider_config"; key: string; value?: unknown }
  | { kind: "tide_surface"; surface: string; payload?: unknown }
  | { kind: "unsupported"; reason: string };

export interface ProviderCapability {
  capabilityId: string;
  provider: NativeProviderId;
  source: "live_protocol" | "generated_schema" | "cli_help" | "manual_audit" | "tide_local";
  kind: ProviderCapabilityKind;
  trigger?: "/" | "$";
  label: string;
  description?: string;
  group: "commands" | "skills" | "session" | "model" | "permission" | "mcp" | "tools" | "setup";
  invoke: ProviderCapabilityInvoke;
  nativePayload?: unknown;
  available: boolean;
}

export function providerCapabilitySortKey(capability: ProviderCapability): string {
  return [
    capability.provider,
    capability.group,
    capability.trigger ?? "",
    capability.label.toLocaleLowerCase(),
    capability.capabilityId,
  ].join(":");
}
