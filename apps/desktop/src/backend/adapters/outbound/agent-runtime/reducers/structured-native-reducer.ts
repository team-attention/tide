import { createReducedNativeEvidenceSnapshot } from "../evidence/native-evidence-store.ts";
import type {
  NativeProviderRuntimeState,
  NativeReducerResult,
  NativeSemanticStateEntry,
} from "../../../../application/domains/native-agent/native-runtime-state.ts";
import type {
  NativeLifecycleStatus,
  NativeRuntimeEvent,
} from "../../../../application/domains/native-agent/native-runtime-event.ts";
import type { SemanticAgentBlockKind } from "../../../../application/domains/native-agent/semantic-agent-block.ts";
import type { StructuredProviderEvent } from "../structured/structured-runtime-events.ts";

export function reduceStructuredNativeEvent(
  state: NativeProviderRuntimeState,
  event: NativeRuntimeEvent,
): NativeReducerResult {
  if (event.nativeSequence <= state.lastSequence) {
    return emptyPatch({ ...state, lastSequence: state.lastSequence }, event);
  }

  const next: NativeProviderRuntimeState = {
    ...state,
    providerSessionId: event.providerSessionId ?? state.providerSessionId,
    lastSequence: event.nativeSequence,
    entries: new Map(state.entries),
  };
  const evidence = createReducedNativeEvidenceSnapshot(event);
  const payload = structuredPayload(event);
  const dirty: string[] = [];

  if (payload === undefined) {
    dirty.push(upsertNotice(next, event, evidence, "Unknown native event", "Native payload was not readable."));
    return patch(next, event, dirty, [evidence]);
  }

  switch (payload.kind) {
    case "provider_capabilities": {
      const agentInfo = isRecord(payload.agentInfo) ? payload.agentInfo : {};
      const authMethods = Array.isArray(payload.authMethods) ? payload.authMethods : [];
      const agentCapabilities = isRecord(payload.agentCapabilities) ? payload.agentCapabilities : {};
      const title = stringField(agentInfo, "title") ?? stringField(agentInfo, "name") ?? "Provider capabilities";
      dirty.push(upsertEntry(next, event, evidence, {
        key: `provider_capabilities:${event.runtimeId}`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:provider-capabilities`,
        kind: "config_state",
        status: "completed",
        title: "Provider capabilities",
        body: providerCapabilitiesBody(title, authMethods.length, Object.keys(agentCapabilities).length),
        data: {
          protocolVersion: payload.protocolVersion,
          agentInfo,
          authMethods,
          agentCapabilities,
          nativePayload: payload.nativePayload,
        },
      }));
      break;
    }
    case "session_ref": {
      next.providerSessionId = payload.ref.value;
      dirty.push(upsertEntry(next, event, evidence, {
        key: `session:${payload.ref.value}`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:session:${payload.ref.value}`,
        kind: "session_event",
        status: "completed",
        title: "Session linked",
        body: payload.ref.value,
        data: { providerSessionRef: payload.ref },
      }));
      break;
    }
    case "turn_started": {
      dirty.push(upsertEntry(next, event, evidence, {
        key: `turn:${event.runtimeId}:active`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:turn:active`,
        kind: "session_event",
        status: "running",
        title: "Turn started",
        data: {},
      }));
      break;
    }
    case "content_delta": {
      dirty.push(upsertEntry(next, event, evidence, {
        key: `block:${payload.blockId}`,
        blockId: payload.blockId,
        kind: payload.blockKind === "reasoning" ? "reasoning" : "message",
        status: "running",
        body: payload.body,
        data: { role: payload.role, blockKind: payload.blockKind },
      }));
      break;
    }
    case "content_record": {
      const semantic = semanticFromContentPayload(payload.payload);
      dirty.push(upsertEntry(next, event, evidence, {
        key: `record:${payload.sourceRef}`,
        blockId: blockIdFromContentPayload(payload.sourceRef, payload.payload),
        kind: semantic.kind,
        status: semantic.status,
        title: semantic.title,
        body: payload.body,
        data: {
          sourceRef: payload.sourceRef,
          payloadType: stringField(payload.payload, "type"),
          nativePayload: payload.payload,
        },
      }));
      break;
    }
    case "prompt": {
      const prompt = payload.promptState;
      dirty.push(upsertEntry(next, event, evidence, {
        key: `prompt:${prompt.promptId}`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:prompt:${prompt.promptId}`,
        kind: prompt.kind === "approval" || prompt.kind === "permission" ? "approval_prompt" : "question_prompt",
        status: prompt.kind === "approval" || prompt.kind === "permission" ? "waiting_for_approval" : "waiting_for_input",
        title: prompt.header ?? prompt.message,
        body: prompt.message,
        parentBlockId: parentBlockIdForNativeIds(next, event.nativeIds),
        data: { promptState: prompt },
      }));
      break;
    }
    case "prompt_withdrawn": {
      dirty.push(upsertPromptStatus(next, event, evidence, payload.promptId, "cancelled"));
      break;
    }
    case "commands": {
      dirty.push(upsertEntry(next, event, evidence, {
        key: `commands:${event.runtimeId}`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:commands`,
        kind: "config_state",
        status: "completed",
        title: "Commands updated",
        body: `${payload.commands.length} command${payload.commands.length === 1 ? "" : "s"}`,
        data: { commands: payload.commands },
      }));
      break;
    }
    case "model_catalog": {
      dirty.push(upsertEntry(next, event, evidence, {
        key: `model_catalog:${event.runtimeId}`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:model-catalog`,
        kind: "config_state",
        status: "completed",
        title: "Model catalog updated",
        body: payload.currentModel,
        data: { models: payload.models, currentModel: payload.currentModel },
      }));
      break;
    }
    case "usage": {
      const usage = normalizeUsage(payload.usage);
      dirty.push(upsertEntry(next, event, evidence, {
        key: `usage:${event.runtimeId}`,
        blockId: `usage:${event.tideThreadId}:${event.runtimeId}`,
        kind: "usage",
        status: "completed",
        title: "Usage",
        body: usageBlockBody(usage),
        data: {
          runtimeId: event.runtimeId,
          scope: "session",
          usage,
          nativeUnits: payload.usage,
        },
      }));
      break;
    }
    case "live_activity": {
      const activity = {
        nestedAgents: payload.nestedAgents,
        nestedToolCalls: payload.nestedToolCalls,
        planTotal: payload.planTotal,
        planCompleted: payload.planCompleted,
      };
      const empty = isEmptyActivity(activity);
      dirty.push(upsertEntry(next, event, evidence, {
        key: `activity:${event.runtimeId}`,
        blockId: `agent-activity:${event.tideThreadId}:${event.runtimeId}`,
        kind: "agent_activity",
        status: empty ? "completed" : "running",
        title: "Activity",
        body: empty ? "Activity complete" : activityBlockBody(activity),
        data: {
          runtimeId: event.runtimeId,
          activity,
          activityKind: "provider_extension",
          label: "Agent activity",
          status: empty ? "completed" : "running",
          nativeFields: payload,
        },
      }));
      break;
    }
    case "runtime_notice": {
      dirty.push(upsertNotice(next, event, evidence, "Runtime notice", payload.message));
      break;
    }
    case "turn_completed": {
      dirty.push(upsertEntry(next, event, evidence, {
        key: `turn:${event.runtimeId}:active`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:turn:active`,
        kind: "session_event",
        status: payload.notice === undefined ? "completed" : "failed",
        title: payload.notice === undefined ? "Turn completed" : "Turn failed",
        body: payload.notice,
        data: { usage: payload.usage },
      }));
      if (payload.usage !== undefined) {
        const usage = normalizeUsage(payload.usage);
        dirty.push(upsertEntry(next, event, evidence, {
          key: `usage:${event.runtimeId}`,
          blockId: `usage:${event.tideThreadId}:${event.runtimeId}`,
          kind: "usage",
          status: "completed",
          title: "Usage",
          body: usageBlockBody(usage),
          data: {
            runtimeId: event.runtimeId,
            scope: "turn",
            usage,
            nativeUnits: payload.usage,
          },
        }));
      }
      dirty.push(upsertEntry(next, event, evidence, {
        key: `activity:${event.runtimeId}`,
        blockId: `agent-activity:${event.tideThreadId}:${event.runtimeId}`,
        kind: "agent_activity",
        status: "completed",
        title: "Activity",
        body: "Activity complete",
        data: {
          runtimeId: event.runtimeId,
          activity: {},
          activityKind: "provider_extension",
          label: "Agent activity",
          status: "completed",
          nativeFields: {},
        },
      }));
      break;
    }
    case "runtime_exited": {
      dirty.push(upsertEntry(next, event, evidence, {
        key: `runtime:${event.runtimeId}:exit`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:exit`,
        kind: "session_event",
        status: payload.exitCode === 0 ? "completed" : "failed",
        title: "Runtime exited",
        body: payload.exitCode === null ? "signal" : String(payload.exitCode),
        data: { exitCode: payload.exitCode },
      }));
      break;
    }
    case "goal_updated":
    case "goal_cleared": {
      dirty.push(upsertEntry(next, event, evidence, {
        key: `goal:${event.runtimeId}`,
        blockId: `native:${event.tideThreadId}:${event.runtimeId}:goal`,
        kind: "config_state",
        status: "completed",
        title: payload.kind === "goal_updated" ? "Goal updated" : "Goal cleared",
        data: payload.kind === "goal_updated" ? { goal: payload.goal } : {},
      }));
      break;
    }
  }

  return patch(next, event, dirty, [evidence]);
}

function emptyPatch(
  state: NativeProviderRuntimeState,
  event: NativeRuntimeEvent,
): NativeReducerResult {
  return patch(state, event, [], []);
}

function patch(
  state: NativeProviderRuntimeState,
  event: NativeRuntimeEvent,
  dirty: string[],
  evidence: ReturnType<typeof createReducedNativeEvidenceSnapshot>[],
): NativeReducerResult {
  return {
    state,
    patch: {
      provider: state.provider,
      transport: state.transport,
      runtimeId: state.runtimeId,
      tideThreadId: state.tideThreadId,
      providerSessionId: state.providerSessionId,
      affectedNativeIds: dirty.length > 0 ? [event.nativeIds] : [],
      semanticDirtyKeys: dirty,
      evidence,
    },
  };
}

function upsertEntry(
  state: NativeProviderRuntimeState,
  event: NativeRuntimeEvent,
  evidence: ReturnType<typeof createReducedNativeEvidenceSnapshot>,
  input: {
    key: string;
    blockId: string;
    kind: SemanticAgentBlockKind;
    status: NativeLifecycleStatus;
    title?: string;
    body?: string;
    data: Record<string, unknown>;
    parentBlockId?: string;
  },
): string {
  const existing = state.entries.get(input.key);
  const entry: NativeSemanticStateEntry = {
    key: input.key,
    blockId: input.blockId,
    kind: input.kind,
    provider: state.provider,
    transport: state.transport,
    tideThreadId: state.tideThreadId,
    runtimeId: state.runtimeId,
    providerSessionId: state.providerSessionId,
    nativeIds: event.nativeIds,
    parentBlockId: input.parentBlockId ?? existing?.parentBlockId,
    status: input.status,
    title: input.title ?? existing?.title,
    body: input.body ?? existing?.body,
    data: input.data,
    evidence: [...(existing?.evidence ?? []), evidence].slice(-20),
    createdAt: existing?.createdAt ?? event.receivedAt,
    updatedAt: event.receivedAt,
  };
  state.entries.set(input.key, entry);
  return input.key;
}

function upsertPromptStatus(
  state: NativeProviderRuntimeState,
  event: NativeRuntimeEvent,
  evidence: ReturnType<typeof createReducedNativeEvidenceSnapshot>,
  promptId: string,
  status: NativeLifecycleStatus,
): string {
  const key = `prompt:${promptId}`;
  const existing = state.entries.get(key);
  if (existing === undefined) {
    return upsertEntry(state, event, evidence, {
      key,
      blockId: `native:${event.tideThreadId}:${event.runtimeId}:prompt:${promptId}`,
      kind: "question_prompt",
      status,
      title: "Prompt withdrawn",
      data: { promptId },
    });
  }
  return upsertEntry(state, event, evidence, {
    key,
    blockId: existing.blockId,
    kind: existing.kind,
    status,
    title: existing.title,
    body: existing.body,
    data: existing.data,
  });
}

function upsertNotice(
  state: NativeProviderRuntimeState,
  event: NativeRuntimeEvent,
  evidence: ReturnType<typeof createReducedNativeEvidenceSnapshot>,
  title: string,
  body: string,
): string {
  return upsertEntry(state, event, evidence, {
    key: `notice:${event.eventId}`,
    blockId: `native:${event.tideThreadId}:${event.runtimeId}:notice:${event.eventId}`,
    kind: "notice",
    status: "completed",
    title,
    body,
    data: {},
  });
}

function parentBlockIdForNativeIds(
  state: NativeProviderRuntimeState,
  nativeIds: NativeRuntimeEvent["nativeIds"],
): string | undefined {
  for (const entry of state.entries.values()) {
    if (entry.kind === "approval_prompt" || entry.kind === "question_prompt") {
      continue;
    }
    if (nativeIds.callId !== undefined && entry.nativeIds.callId === nativeIds.callId) {
      return entry.blockId;
    }
    if (nativeIds.itemId !== undefined && entry.nativeIds.itemId === nativeIds.itemId) {
      return entry.blockId;
    }
    if (nativeIds.blockId !== undefined && entry.blockId === nativeIds.blockId) {
      return entry.blockId;
    }
  }
  return undefined;
}

function structuredPayload(event: NativeRuntimeEvent): StructuredProviderEvent | undefined {
  const payload = event.payload;
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  return typeof record.kind === "string" ? (record as StructuredProviderEvent) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function semanticFromContentPayload(payload: Record<string, unknown>): {
  kind: SemanticAgentBlockKind;
  status: NativeLifecycleStatus;
  title?: string;
} {
  switch (payload.type) {
    case "reasoning":
      return { kind: "reasoning", status: statusFromPayload(payload), title: stringField(payload, "title") ?? "Thinking" };
    case "tool_call":
    case "tool_result":
      return { kind: toolKindFromPayload(payload), status: statusFromPayload(payload), title: stringField(payload, "toolName") };
    case "approval_prompt":
      return { kind: "approval_prompt", status: "waiting_for_approval", title: stringField(payload, "title") };
    case "question_prompt":
    case "choice_prompt":
      return { kind: "question_prompt", status: "waiting_for_input", title: stringField(payload, "title") };
    case "plan":
      return { kind: "plan", status: statusFromPayload(payload), title: stringField(payload, "title") };
    case "notice":
      return { kind: "notice", status: "failed", title: stringField(payload, "title") };
    case "message":
    default:
      return { kind: "message", status: statusFromPayload(payload), title: stringField(payload, "title") };
  }
}

function toolKindFromPayload(payload: Record<string, unknown>): SemanticAgentBlockKind {
  const toolName = (stringField(payload, "toolName") ?? "").toLocaleLowerCase();
  if (toolName.includes("mcp") || toolName.includes(".")) {
    return "mcp_call";
  }
  if (
    toolName === "tide_run_terminal_command" ||
    toolName === "shell" ||
    toolName === "bash" ||
    toolName.includes("terminal") ||
    toolName.includes("command")
  ) {
    return "command_run";
  }
  if (toolName === "tide_edit_file" || toolName.includes("edit") || toolName.includes("patch")) {
    return "file_change";
  }
  return "tool_call";
}

function blockIdFromContentPayload(sourceRef: string, payload: Record<string, unknown>): string {
  return stringField(payload, "blockId") ?? sourceRef;
}

function statusFromPayload(payload: Record<string, unknown>): NativeLifecycleStatus {
  switch (payload.status) {
    case "failed":
      return "failed";
    case "pending":
      return "pending";
    case "streaming":
      return "running";
    case "needs_input":
      return "waiting_for_input";
    case "complete":
    default:
      return "completed";
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

type UsageInput = Extract<StructuredProviderEvent, { kind: "usage" }>["usage"];

function normalizeUsage(usage: UsageInput | null | undefined): Record<string, unknown> {
  if (usage === undefined || usage === null) {
    return {};
  }
  const totalTokens =
    usage.totalTokens ??
    (usage.inputTokens !== undefined || usage.outputTokens !== undefined
      ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
      : undefined);
  const contextTokens = usage.contextTokens ?? totalTokens;
  const contextUsedPercent =
    contextTokens !== undefined && usage.contextWindow !== undefined && usage.contextWindow > 0
      ? Math.round((contextTokens / usage.contextWindow) * 100)
      : undefined;
  return {
    ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
    ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(contextTokens !== undefined ? { contextTokens } : {}),
    ...(usage.contextWindow !== undefined ? { contextWindow: usage.contextWindow } : {}),
    ...(contextUsedPercent !== undefined ? { contextUsedPercent } : {}),
    ...(usage.rateLimits !== undefined ? { rateLimits: usage.rateLimits } : {}),
  };
}

function usageBlockBody(usage: Record<string, unknown>): string {
  const parts: string[] = [];
  const totalTokens = numericUsageField(usage, "totalTokens");
  const contextTokens = numericUsageField(usage, "contextTokens");
  const contextWindow = numericUsageField(usage, "contextWindow");
  const contextUsedPercent = numericUsageField(usage, "contextUsedPercent");
  if (totalTokens !== undefined) {
    parts.push(`${formatCompactNumber(totalTokens)} tokens`);
  }
  if (contextTokens !== undefined && contextWindow !== undefined) {
    parts.push(`${formatCompactNumber(contextTokens)} / ${formatCompactNumber(contextWindow)} context`);
  } else if (contextTokens !== undefined) {
    parts.push(`${formatCompactNumber(contextTokens)} context tokens`);
  }
  if (contextUsedPercent !== undefined) {
    parts.push(`${contextUsedPercent}% context`);
  }
  const rateLimits = usage.rateLimits;
  const rateLimitCount = Array.isArray(rateLimits) ? rateLimits.length : 0;
  if (rateLimitCount > 0) {
    parts.push(`${rateLimitCount} quota ${rateLimitCount === 1 ? "window" : "windows"}`);
  }
  return parts.length === 0 ? "Usage updated" : `Usage updated: ${parts.join(" · ")}`;
}

function providerCapabilitiesBody(agentTitle: string, authMethodCount: number, capabilityCount: number): string {
  const parts = [agentTitle];
  if (authMethodCount > 0) {
    parts.push(`${authMethodCount} auth ${authMethodCount === 1 ? "method" : "methods"}`);
  }
  if (capabilityCount > 0) {
    parts.push(`${capabilityCount} capability ${capabilityCount === 1 ? "group" : "groups"}`);
  }
  return parts.join(" · ");
}

function numericUsageField(usage: Record<string, unknown>, key: string): number | undefined {
  const value = usage[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface ActivityInput {
  nestedAgents?: number;
  nestedToolCalls?: number;
  planTotal?: number;
  planCompleted?: number;
}

function activityBlockBody(activity: ActivityInput): string {
  const nestedAgents = activity.nestedAgents ?? 0;
  if (nestedAgents > 0) {
    const calls = activity.nestedToolCalls ?? 0;
    const agents = `${nestedAgents} ${nestedAgents === 1 ? "agent" : "agents"}`;
    return calls > 0
      ? `${agents} running · ${calls} tool ${calls === 1 ? "call" : "calls"}`
      : `${agents} running`;
  }
  const planTotal = activity.planTotal ?? 0;
  if (planTotal > 0) {
    const completed = activity.planCompleted ?? 0;
    return `${completed}/${planTotal} steps`;
  }
  return "Activity running";
}

function isEmptyActivity(activity: ActivityInput): boolean {
  return (
    activity.nestedAgents === undefined &&
    activity.nestedToolCalls === undefined &&
    activity.planTotal === undefined &&
    activity.planCompleted === undefined
  );
}

function formatCompactNumber(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  const thousands = value / 1000;
  if (thousands >= 100 || Number.isInteger(thousands)) {
    return `${Math.round(thousands)}k`;
  }
  return `${thousands.toFixed(1)}k`;
}
