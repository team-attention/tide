import type { ProviderReadinessResult, ThreadSnapshot } from "../../../../application/services/thread/thread-runtime-service.ts";
import { sanitizeJsonValue } from "../../../../../shared/contracts/index.ts";
import type { AgentBindingDto, AgentRuntimeSourceDto, AgentSessionBlockDto, LastKnownStateDto, PromptStateDto, ProviderReadinessDto, ThreadScopeDto, ThreadSummaryDto } from "../../../../../shared/contracts/index.ts";
import { omitUndefinedProperties } from "./workbench-dtos.ts";
// Extracted from backend-contract-message-adapter.ts (spec: navigable-source-structure).

export function toThreadSummaryDto(thread: ThreadSnapshot): ThreadSummaryDto {
  const launchOptions = jsonObject(thread.launchOptions);
  const summary: ThreadSummaryDto = {
    threadId: thread.threadId,
    title: thread.title,
    agentBinding: toAgentBindingDto(thread.agentBinding),
    scope: toThreadScopeDto(thread.scope),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    pinned: thread.pinned ?? false,
    archived: thread.lifecycleState === "archived",
    lastKnownState: thread.lastKnownState as LastKnownStateDto,
    live: thread.live,
    queuedInputs: thread.queuedInputs,
    queuedDeliveries: thread.pendingInputs.map((pending) => ({
      deliveryId: pending.deliveryId ?? pending.capturedAt,
      value: pending.value,
      capturedAt: pending.capturedAt,
      ...(jsonObject(pending.launchOptions) !== undefined
        ? { launchOptions: jsonObject(pending.launchOptions) }
        : {}),
      ...(pending.attachments !== undefined
        ? { attachments: pending.attachments.map((attachment) => ({ ...attachment })) }
        : {}),
    })),
  };
  if (launchOptions !== undefined) {
    summary.launchOptions = launchOptions;
  }
  if (thread.runtimeStartedAt !== undefined) {
    summary.runtimeStartedAt = thread.runtimeStartedAt;
  }
  if (thread.goal !== undefined) {
    summary.goal = thread.goal;
  }
  if (thread.goalState !== undefined) {
    summary.goalState = { ...thread.goalState };
  }
  return summary;
}

function toAgentBindingDto(binding: ThreadSnapshot["agentBinding"]): AgentBindingDto {
  const dto: AgentBindingDto = {
    agentId: binding.agentId,
    runtimeSource: toAgentRuntimeSourceDto(
      binding.runtimeSource ?? defaultRuntimeSourceForAgent(binding.agentId),
    ),
  };
  if (binding.providerSessionRef !== undefined) {
    dto.providerSessionRef = {
      kind: binding.providerSessionRef.kind,
      value: binding.providerSessionRef.value,
    };
    if (binding.providerSessionRef.transcriptPath !== undefined) {
      dto.providerSessionRef.transcriptPath = binding.providerSessionRef.transcriptPath;
    }
    if (binding.providerSessionRef.logPath !== undefined) {
      dto.providerSessionRef.logPath = binding.providerSessionRef.logPath;
    }
  }
  return dto;
}

function toAgentRuntimeSourceDto(
  source: AgentRuntimeSourceDto,
): AgentRuntimeSourceDto {
  return { kind: "provider_cli", integrationId: source.integrationId };
}

function defaultRuntimeSourceForAgent(
  agentId: ThreadSnapshot["agentBinding"]["agentId"],
): AgentRuntimeSourceDto {
  return { kind: "provider_cli", integrationId: agentId };
}

function toThreadScopeDto(scope: ThreadSnapshot["scope"]): ThreadScopeDto {
  if (scope === undefined) {
    return { kind: "scratch", scratchCwd: "" };
  }
  return { ...scope };
}

export function toAgentSessionBlockDto(
  thread: ThreadSnapshot,
  block: ThreadSnapshot["cachedBlocks"][number],
): AgentSessionBlockDto {
  return omitUndefinedProperties({
    blockId: block.blockId,
    threadId: thread.threadId,
    agentId: block.agentId ?? thread.agentBinding.agentId,
    kind: block.kind,
    parentBlockId: block.parentBlockId,
    role: block.role,
    sourceFrameIds: block.sourceFrameIds?.map((frameId) => frameId),
    localProvenance: jsonObject(block.localProvenance),
    status: block.status,
    title: block.title,
    body: block.body,
    data: jsonObject(block.data),
    rawFallback: block.rawFallback,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  });
}

function jsonObject(value: Record<string, unknown> | undefined): AgentSessionBlockDto["data"] {
  if (value === undefined) {
    return undefined;
  }
  const sanitized = sanitizeJsonValue(value);
  if (sanitized === undefined || sanitized === null || Array.isArray(sanitized) || typeof sanitized !== "object") {
    return undefined;
  }
  return sanitized;
}

export function toProviderReadinessDto(
  readiness: ProviderReadinessResult,
): ProviderReadinessDto {
  return {
    agentId: readiness.agentId,
    ready: readiness.ready,
    blockers: readiness.blockers.map((blocker) => ({ ...blocker })),
    // Non-blocking "newer CLI published" advisory rides alongside, never gating `ready`.
    ...(readiness.update
      ? {
          update: {
            ...readiness.update,
            ...(readiness.update.terminalAction
              ? { terminalAction: { ...readiness.update.terminalAction } }
              : {}),
          },
        }
      : {}),
  };
}

export function toPromptStateDto(prompt: NonNullable<ThreadSnapshot["promptState"]>): PromptStateDto {
  return {
    ...prompt,
    choices: prompt.choices?.map((choice) => ({ ...choice })),
    steps: prompt.steps?.map((step) => ({
      ...step,
      choices: step.choices?.map((choice) => ({ ...choice })),
    })),
  };
}
