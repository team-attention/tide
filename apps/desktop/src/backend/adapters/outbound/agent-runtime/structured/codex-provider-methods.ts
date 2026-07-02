import type {
  AgentRuntimeCapabilityInvocationInput,
  AgentRuntimeCapabilityInvocationResult,
} from "../../../../application/domains/agent-runtime/agent-runtime.ts";
import { isRecord } from "./codex-app-server-shared.ts";

export async function invokeCodexProviderCapability(input: {
  capability: AgentRuntimeCapabilityInvocationInput;
  codexThreadId?: string;
  request: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>;
}): Promise<AgentRuntimeCapabilityInvocationResult> {
  if (input.capability.invoke.kind !== "provider_method") {
    return {
      status: "unsupported",
      reason: `Capability ${input.capability.capabilityId} is not a Codex app-server method.`,
    };
  }
  const params = codexProviderMethodParams(
    input.capability.invoke.method,
    input.capability.params ?? input.capability.invoke.params,
    input.codexThreadId,
  );
  const result = await input.request(input.capability.invoke.method, params);
  return { status: "handled", result };
}

function codexProviderMethodParams(
  method: string,
  params: unknown,
  codexThreadId: string | undefined,
): Record<string, unknown> {
  const result = isRecord(params) ? { ...params } : {};
  if (method === "skills/list" && result.cwds === undefined) {
    result.cwds = [];
  }
  if (codexProviderMethodNeedsThreadId(method)) {
    if (codexThreadId === undefined) {
      throw new Error(`Codex method ${method} requires an initialized provider thread.`);
    }
    if (result.threadId === undefined) {
      result.threadId = codexThreadId;
    }
  }
  return result;
}

function codexProviderMethodNeedsThreadId(method: string): boolean {
  return method.startsWith("thread/") || method.startsWith("review/");
}
