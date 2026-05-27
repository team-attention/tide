export const CONTRACT_VERSION = 1;

export type ContractVersion = 1;
export type RequestId = string;
export type BackendEventId = string;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue;
}

export type ThreadId = string;
export type ProjectId = string;
export type WorkbenchPaneId = string;

export type AgentId = "codex" | "claude" | "antigravity";

export interface AgentBindingDto {
  agentId: AgentId;
  providerSessionRef?: ProviderSessionRefDto;
}

export interface ProviderSessionRefDto {
  kind:
    | "codex_rollout"
    | "claude_transcript"
    | "antigravity_conversation"
    | "provider_native";
  value: string;
  transcriptPath?: string;
  logPath?: string;
}

export interface ThreadSummaryDto {
  threadId: ThreadId;
  title: string;
  agentBinding: AgentBindingDto;
  scope: ThreadScopeDto;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  archived: boolean;
  lastKnownState: LastKnownStateDto;
}

export type ThreadScopeDto =
  | { kind: "project"; projectId: ProjectId; cwd: string }
  | { kind: "scratch"; scratchCwd: string };

export type LastKnownStateDto =
  | "idle"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "failed"
  | "archived";

export type AgentRuntimeStateDto =
  | "not_started"
  | "starting"
  | "running"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "idle"
  | "stopping"
  | "stopped"
  | "failed";

export interface ProviderReadinessDto {
  agentId: AgentId;
  ready: boolean;
  blockers: ProviderReadinessBlockerDto[];
}

export interface ProviderReadinessBlockerDto {
  kind:
    | "not_installed"
    | "not_authenticated"
    | "onboarding_required"
    | "directory_trust_required"
    | "hook_bootstrap_required"
    | "unknown";
  message: string;
  action?: "open_terminal" | "open_provider" | "retry" | "none";
}

export type PromptKindDto =
  | "question"
  | "approval"
  | "permission"
  | "choice"
  | "command_picker";

export interface PromptStateDto {
  promptId: string;
  threadId: ThreadId;
  agentId: AgentId;
  kind: PromptKindDto;
  message: string;
  choices?: PromptChoiceDto[];
  defaultChoiceId?: string;
  source: "pty" | "provider_signal" | "provider_hook";
}

export interface PromptChoiceDto {
  choiceId: string;
  label: string;
  providerValue: string;
}

export interface AgentSessionBlockDto {
  blockId: string;
  threadId: ThreadId;
  kind: string;
  status: "pending" | "streaming" | "complete" | "failed" | "needs_input";
  updatedAt: string;
  body?: string;
  data?: JsonObject;
}

export interface WorkbenchPaneRefDto {
  paneId: WorkbenchPaneId;
  kind: "browser" | "diff" | "editor" | "terminal";
  title: string;
  visible: boolean;
  updatedAt: string;
}

export type BackendCommandKind =
  | "thread.hydrate"
  | "thread.start"
  | "agentRuntime.resume"
  | "composer.sendInput"
  | "prompt.answer"
  | "agentRuntime.stop"
  | "workbench.command";

export const BACKEND_COMMAND_KINDS = [
  "thread.hydrate",
  "thread.start",
  "agentRuntime.resume",
  "composer.sendInput",
  "prompt.answer",
  "agentRuntime.stop",
  "workbench.command",
];

export interface BackendCommandPayloadByKind {
  "thread.hydrate": { threadId: ThreadId };
  "thread.start": {
    initialMessage: string;
    agentBinding: AgentBindingDto;
    scope?: ThreadScopeDto;
    launchOptions?: JsonObject;
  };
  "agentRuntime.resume": { threadId: ThreadId };
  "composer.sendInput": { threadId: ThreadId; input: string };
  "prompt.answer": {
    promptId: string;
    threadId: ThreadId;
    choiceId?: string;
    value?: string;
  };
  "agentRuntime.stop": { threadId: ThreadId };
  "workbench.command": {
    threadId: ThreadId;
    command: string;
    targetPaneId?: WorkbenchPaneId;
    data?: JsonObject;
  };
}

export type BackendEventKind =
  | "command.accepted"
  | "command.completed"
  | "contract.error"
  | "thread.hydrated"
  | "thread.started"
  | "agentRuntime.stateChanged"
  | "providerReadiness.changed"
  | "prompt.changed"
  | "agentSessionBlock.upserted"
  | "agentSessionBlock.completed"
  | "workbench.changed";

export const BACKEND_EVENT_KINDS = [
  "command.accepted",
  "command.completed",
  "contract.error",
  "thread.hydrated",
  "thread.started",
  "agentRuntime.stateChanged",
  "providerReadiness.changed",
  "prompt.changed",
  "agentSessionBlock.upserted",
  "agentSessionBlock.completed",
  "workbench.changed",
];

export type ContractErrorCode =
  | "unsupported_contract_version"
  | "invalid_command"
  | "invalid_event"
  | "unknown_command"
  | "thread_not_found"
  | "provider_not_ready"
  | "agent_runtime_unavailable"
  | "provider_runtime_failed"
  | "workbench_target_not_found"
  | "internal_error";

export const CONTRACT_ERROR_CODES = [
  "unsupported_contract_version",
  "invalid_command",
  "invalid_event",
  "unknown_command",
  "thread_not_found",
  "provider_not_ready",
  "agent_runtime_unavailable",
  "provider_runtime_failed",
  "workbench_target_not_found",
  "internal_error",
];

export interface ContractErrorPayload {
  code: ContractErrorCode;
  message: string;
  severity: "info" | "warning" | "error";
  retryable: boolean;
  details?: JsonObject;
}

export interface BackendEventPayloadByKind {
  "command.accepted": {
    requestId: RequestId;
    acceptedAt: string;
  };
  "command.completed": {
    result?: JsonObject;
  };
  "contract.error": ContractErrorPayload;
  "thread.hydrated": {
    thread: ThreadSummaryDto;
    blocks?: AgentSessionBlockDto[];
    providerReadiness?: ProviderReadinessDto;
    runtimeState?: AgentRuntimeStateDto;
    workbenchPanes?: WorkbenchPaneRefDto[];
  };
  "thread.started": {
    thread: ThreadSummaryDto;
    runtimeState: AgentRuntimeStateDto;
  };
  "agentRuntime.stateChanged": {
    threadId: ThreadId;
    state: AgentRuntimeStateDto;
    changedAt: string;
  };
  "providerReadiness.changed": {
    threadId?: ThreadId;
    readiness: ProviderReadinessDto;
  };
  "prompt.changed": {
    threadId: ThreadId;
    prompt: PromptStateDto | null;
  };
  "agentSessionBlock.upserted": {
    block: AgentSessionBlockDto;
  };
  "agentSessionBlock.completed": {
    blockId: string;
    threadId: ThreadId;
    status: "complete" | "failed";
    completedAt: string;
    error?: ContractErrorPayload;
  };
  "workbench.changed": {
    threadId: ThreadId;
    panes: WorkbenchPaneRefDto[];
  };
}

export interface BackendCommandEnvelope<
  TKind extends BackendCommandKind = BackendCommandKind,
> {
  contractVersion: ContractVersion;
  requestId: RequestId;
  kind: TKind;
  issuedAt: string;
  payload: BackendCommandPayloadByKind[TKind];
}

export interface BackendEventEnvelope<
  TKind extends BackendEventKind = BackendEventKind,
> {
  contractVersion: ContractVersion;
  eventId: BackendEventId;
  requestId?: RequestId;
  kind: TKind;
  emittedAt: string;
  payload: BackendEventPayloadByKind[TKind];
}

export type ContractValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContractErrorPayload };

export function validateBackendCommandEnvelope(
  value: unknown,
): ContractValidationResult<BackendCommandEnvelope> {
  if (!isJsonObject(value)) {
    return contractValidationFailure(
      "invalid_command",
      "BackendCommandEnvelope must be a JSON object.",
    );
  }
  if (value.contractVersion !== CONTRACT_VERSION) {
    return contractValidationFailure(
      "unsupported_contract_version",
      "Unsupported Contract Version.",
    );
  }
  if (!isNonEmptyString(value.requestId)) {
    return contractValidationFailure(
      "invalid_command",
      "BackendCommandEnvelope requires RequestId.",
    );
  }
  if (!isNonEmptyString(value.kind)) {
    return contractValidationFailure(
      "invalid_command",
      "BackendCommandEnvelope requires command kind.",
    );
  }
  if (!includesString(BACKEND_COMMAND_KINDS, value.kind)) {
    return contractValidationFailure("unknown_command", "Unknown command kind.");
  }
  if (!isNonEmptyString(value.issuedAt)) {
    return contractValidationFailure(
      "invalid_command",
      "BackendCommandEnvelope requires issuedAt.",
    );
  }
  if (!isJsonObject(value.payload)) {
    return contractValidationFailure(
      "invalid_command",
      "BackendCommandEnvelope payload must be a JSON object.",
    );
  }

  return { ok: true, value: value as BackendCommandEnvelope };
}

export function validateBackendEventEnvelope(
  value: unknown,
): ContractValidationResult<BackendEventEnvelope> {
  if (!isJsonObject(value)) {
    return contractValidationFailure(
      "invalid_event",
      "BackendEventEnvelope must be a JSON object.",
    );
  }
  if (value.contractVersion !== CONTRACT_VERSION) {
    return contractValidationFailure(
      "unsupported_contract_version",
      "Unsupported Contract Version.",
    );
  }
  if (!isNonEmptyString(value.eventId)) {
    return contractValidationFailure(
      "invalid_event",
      "BackendEventEnvelope requires eventId.",
    );
  }
  if (value.requestId !== undefined && !isNonEmptyString(value.requestId)) {
    return contractValidationFailure(
      "invalid_event",
      "BackendEventEnvelope requestId must be a non-empty string when present.",
    );
  }
  if (!isNonEmptyString(value.kind)) {
    return contractValidationFailure(
      "invalid_event",
      "BackendEventEnvelope requires event kind.",
    );
  }
  if (!includesString(BACKEND_EVENT_KINDS, value.kind)) {
    return contractValidationFailure("invalid_event", "Unknown event kind.");
  }
  if (!isNonEmptyString(value.emittedAt)) {
    return contractValidationFailure(
      "invalid_event",
      "BackendEventEnvelope requires emittedAt.",
    );
  }
  if (!isJsonObject(value.payload)) {
    return contractValidationFailure(
      "invalid_event",
      "BackendEventEnvelope payload must be a JSON object.",
    );
  }

  return { ok: true, value: value as BackendEventEnvelope };
}

export function createCommandAcceptedEvent(
  command: Pick<BackendCommandEnvelope, "requestId">,
  options: { eventId: BackendEventId; emittedAt: string },
): BackendEventEnvelope<"command.accepted"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    requestId: command.requestId,
    kind: "command.accepted",
    emittedAt: options.emittedAt,
    payload: {
      requestId: command.requestId,
      acceptedAt: options.emittedAt,
    },
  };
}

export function createCommandCompletedEvent(
  command: Pick<BackendCommandEnvelope, "requestId">,
  options: { eventId: BackendEventId; emittedAt: string; result?: JsonObject },
): BackendEventEnvelope<"command.completed"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    requestId: command.requestId,
    kind: "command.completed",
    emittedAt: options.emittedAt,
    payload:
      options.result === undefined
        ? {}
        : {
            result: options.result,
          },
  };
}

export function createAgentSessionBlockUpsertedEvent(options: {
  eventId: BackendEventId;
  requestId?: RequestId;
  emittedAt: string;
  block: AgentSessionBlockDto;
}): BackendEventEnvelope<"agentSessionBlock.upserted"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    requestId: options.requestId,
    kind: "agentSessionBlock.upserted",
    emittedAt: options.emittedAt,
    payload: {
      block: options.block,
    },
  };
}

export function createContractErrorPayload(input: {
  code: ContractErrorCode;
  message: string;
  severity: "info" | "warning" | "error";
  retryable: boolean;
  details?: unknown;
}): ContractErrorPayload {
  const payload: ContractErrorPayload = {
    code: input.code,
    message: input.message,
    severity: input.severity,
    retryable: input.retryable,
  };
  const details = sanitizeJsonValue(input.details);
  if (isJsonObject(details)) {
    payload.details = details;
  }

  return payload;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isJsonValue(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueWithSeen(value, new Set<unknown>());
}

function contractValidationFailure(
  code: ContractErrorCode,
  message: string,
): ContractValidationResult<never> {
  return {
    ok: false,
    error: createContractErrorPayload({
      code,
      message,
      severity: "error",
      retryable: false,
    }),
  };
}

function sanitizeJsonValue(
  value: unknown,
  seen: Set<unknown> = new Set<unknown>(),
): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    const sanitized = value
      .map((item) => sanitizeJsonValue(item, seen))
      .filter((item): item is JsonValue => item !== undefined);
    seen.delete(value);
    return sanitized;
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  const sanitized: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitizedChild = sanitizeJsonValue(child, seen);
    if (sanitizedChild !== undefined) {
      sanitized[key] = sanitizedChild;
    }
  }
  seen.delete(value);

  return sanitized;
}

function isJsonValueWithSeen(
  value: unknown,
  seen: Set<unknown>,
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    const ok = value.every((item) => isJsonValueWithSeen(item, seen));
    seen.delete(value);
    return ok;
  }
  if (!isPlainObject(value)) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  const ok = Object.values(value).every((item) =>
    isJsonValueWithSeen(item, seen),
  );
  seen.delete(value);
  return ok;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function includesString(values: string[], value: string): boolean {
  return values.includes(value);
}
