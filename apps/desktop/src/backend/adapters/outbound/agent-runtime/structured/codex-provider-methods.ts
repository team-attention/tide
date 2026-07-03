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
  if (method === "review/start") {
    return codexReviewStartParams(params, codexThreadId);
  }
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

function codexReviewStartParams(params: unknown, codexThreadId: string | undefined): Record<string, unknown> {
  if (codexThreadId === undefined) {
    throw new Error("Codex method review/start requires an initialized provider thread.");
  }
  const input = isRecord(params) ? { ...params } : {};
  const targetInput = input.target ?? params;
  const target = codexReviewTarget(targetInput);
  return {
    threadId: codexThreadId,
    target,
    ...(input.delivery === "inline" || input.delivery === "detached" ? { delivery: input.delivery } : {}),
  };
}

function codexReviewTarget(target: unknown): Record<string, unknown> {
  if (!isRecord(target)) {
    return { type: "uncommittedChanges" };
  }
  if (target.type === "uncommittedChanges") {
    return { type: "uncommittedChanges" };
  }
  if (target.type === "baseBranch" && typeof target.branch === "string" && target.branch.length > 0) {
    return { type: "baseBranch", branch: target.branch };
  }
  if (target.type === "commit" && typeof target.sha === "string" && target.sha.length > 0) {
    return {
      type: "commit",
      sha: target.sha,
      ...(typeof target.title === "string" ? { title: target.title } : {}),
    };
  }
  if (target.type === "custom" && typeof target.instructions === "string") {
    return { type: "custom", instructions: target.instructions };
  }
  switch (target.kind) {
    case "uncommitted":
      return { type: "uncommittedChanges" };
    case "base_branch":
      if (typeof target.baseBranch === "string" && target.baseBranch.length > 0) {
        return { type: "baseBranch", branch: target.baseBranch };
      }
      break;
    case "commit":
      if (typeof target.sha === "string" && target.sha.length > 0) {
        return {
          type: "commit",
          sha: target.sha,
          ...(typeof target.title === "string" ? { title: target.title } : {}),
        };
      }
      break;
    case "custom":
      if (typeof target.instructions === "string") {
        return { type: "custom", instructions: target.instructions };
      }
      break;
  }
  throw new Error("Invalid Codex review/start target.");
}
