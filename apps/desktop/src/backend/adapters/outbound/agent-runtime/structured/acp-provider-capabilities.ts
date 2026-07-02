import type { StructuredProviderEvent } from "./structured-runtime-events.ts";

export function acpProviderCapabilitiesEvent(
  result: Record<string, unknown>,
): Extract<StructuredProviderEvent, { kind: "provider_capabilities" }> {
  const protocolVersion = numberField(result, "protocolVersion");
  const agentInfo = isRecord(result.agentInfo) ? result.agentInfo : undefined;
  const authMethods = Array.isArray(result.authMethods) ? result.authMethods : undefined;
  const agentCapabilities = isRecord(result.agentCapabilities) ? result.agentCapabilities : undefined;
  return {
    kind: "provider_capabilities",
    ...(protocolVersion !== undefined ? { protocolVersion } : {}),
    ...(agentInfo !== undefined ? { agentInfo } : {}),
    ...(authMethods !== undefined ? { authMethods } : {}),
    ...(agentCapabilities !== undefined ? { agentCapabilities } : {}),
    nativePayload: result,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
