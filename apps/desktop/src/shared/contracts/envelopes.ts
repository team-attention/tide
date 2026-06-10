import type { AgentSessionBlockDto } from "./agent-session-block.ts";
import {
  BACKEND_COMMAND_KINDS,
  type BackendCommandKind,
  type BackendCommandPayloadByKind,
} from "./commands.ts";
import {
  createContractErrorPayload,
  type ContractErrorCode,
  type ContractErrorPayload,
} from "./errors.ts";
import type { ConnectionState } from "./connection.ts";
import {
  BACKEND_EVENT_KINDS,
  type BackendEventKind,
  type BackendEventPayloadByKind,
} from "./events.ts";
import {
  CONTRACT_VERSION,
  type BackendEventId,
  type ContractVersion,
  type RequestId,
  type ThreadId,
} from "./ids.ts";
import type { JsonObject } from "./json.ts";
import { isJsonObject } from "./json.ts";

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
  if (value.contractVersion === undefined) {
    return contractValidationFailure(
      "invalid_command",
      "BackendCommandEnvelope requires Contract Version.",
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
  const payloadResult = validateCommandPayload(value.kind, value.payload);
  if (!payloadResult.ok) {
    return payloadResult;
  }

  return { ok: true, value: value as unknown as BackendCommandEnvelope };
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
  if (value.contractVersion === undefined) {
    return contractValidationFailure(
      "invalid_event",
      "BackendEventEnvelope requires Contract Version.",
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

  return { ok: true, value: value as unknown as BackendEventEnvelope };
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

export function createContractErrorEvent(options: {
  eventId: BackendEventId;
  requestId?: RequestId;
  emittedAt: string;
  error: ContractErrorPayload;
}): BackendEventEnvelope<"contract.error"> {
  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    kind: "contract.error",
    emittedAt: options.emittedAt,
    payload: options.error,
  };
}

export function createBackendConnectionChangedEvent(options: {
  eventId: BackendEventId;
  emittedAt: string;
  state: ConnectionState;
  backendInstanceId?: string;
  reason?: ContractErrorPayload;
}): BackendEventEnvelope<"backend.connectionChanged"> {
  const payload: BackendEventPayloadByKind["backend.connectionChanged"] = {
    state: options.state,
  };
  if (options.backendInstanceId !== undefined) {
    payload.backendInstanceId = options.backendInstanceId;
  }
  if (options.reason !== undefined) {
    payload.reason = options.reason;
  }

  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    kind: "backend.connectionChanged",
    emittedAt: options.emittedAt,
    payload,
  };
}

export function createBackendSnapshotRequestedEvent(options: {
  eventId: BackendEventId;
  emittedAt: string;
  activeThreadId?: ThreadId;
}): BackendEventEnvelope<"backend.snapshotRequested"> {
  const payload: BackendEventPayloadByKind["backend.snapshotRequested"] = {};
  if (options.activeThreadId !== undefined) {
    payload.activeThreadId = options.activeThreadId;
  }

  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    kind: "backend.snapshotRequested",
    emittedAt: options.emittedAt,
    payload,
  };
}

export function createBackendSnapshotReadyEvent(options: {
  eventId: BackendEventId;
  emittedAt: string;
  activeThreadId?: ThreadId;
}): BackendEventEnvelope<"backend.snapshotReady"> {
  const payload: BackendEventPayloadByKind["backend.snapshotReady"] = {};
  if (options.activeThreadId !== undefined) {
    payload.activeThreadId = options.activeThreadId;
  }

  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    kind: "backend.snapshotReady",
    emittedAt: options.emittedAt,
    payload,
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
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    kind: "agentSessionBlock.upserted",
    emittedAt: options.emittedAt,
    payload: {
      block: options.block,
    },
  };
}

export function createAgentSessionBlockCompletedEvent(options: {
  eventId: BackendEventId;
  requestId?: RequestId;
  emittedAt: string;
  blockId: string;
  threadId: ThreadId;
  status: "complete" | "failed";
  completedAt: string;
  error?: ContractErrorPayload;
}): BackendEventEnvelope<"agentSessionBlock.completed"> {
  const payload: BackendEventPayloadByKind["agentSessionBlock.completed"] = {
    blockId: options.blockId,
    threadId: options.threadId,
    status: options.status,
    completedAt: options.completedAt,
  };
  if (options.error !== undefined) {
    payload.error = options.error;
  }

  return {
    contractVersion: CONTRACT_VERSION,
    eventId: options.eventId,
    ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
    kind: "agentSessionBlock.completed",
    emittedAt: options.emittedAt,
    payload,
  };
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

function validateCommandPayload(
  kind: string,
  payload: JsonObject,
): ContractValidationResult<void> {
  if (kind !== "thread.start") {
    return { ok: true, value: undefined };
  }

  const agentBinding = payload.agentBinding;
  if (!isJsonObject(agentBinding)) {
    return contractValidationFailure(
      "invalid_command",
      "thread.start requires an Agent Binding.",
    );
  }

  return validateAgentBinding(agentBinding);
}

function validateAgentBinding(binding: JsonObject): ContractValidationResult<void> {
  if (!isNonEmptyString(binding.agentId)) {
    return contractValidationFailure(
      "invalid_command",
      "Agent Binding requires agentId.",
    );
  }

  if (!isKnownAgentId(binding.agentId)) {
    return contractValidationFailure("invalid_command", "Unknown Agent Binding agentId.");
  }

  if (binding.runtimeSource === undefined) {
    if (binding.agentId === "openai_api") {
      return contractValidationFailure(
        "invalid_command",
        "OpenAI API Agent Binding requires tide_api runtimeSource.",
      );
    }
    return { ok: true, value: undefined };
  }

  if (!isJsonObject(binding.runtimeSource)) {
    return contractValidationFailure(
      "invalid_command",
      "Agent Binding runtimeSource must be a JSON object.",
    );
  }

  const runtimeSource = binding.runtimeSource;
  if (runtimeSource.kind === "provider_cli") {
    if (!isProviderCliAgentId(binding.agentId)) {
      return contractValidationFailure(
        "invalid_command",
        "provider_cli runtimeSource requires a Provider CLI agentId.",
      );
    }
    if (runtimeSource.integrationId !== binding.agentId) {
      return contractValidationFailure(
        "invalid_command",
        "provider_cli runtimeSource integrationId must match agentId.",
      );
    }
    return { ok: true, value: undefined };
  }

  if (runtimeSource.kind === "tide_api") {
    if (binding.agentId !== "openai_api" || runtimeSource.provider !== "openai") {
      return contractValidationFailure(
        "invalid_command",
        "tide_api runtimeSource requires OpenAI API agentId and provider.",
      );
    }
    return { ok: true, value: undefined };
  }

  return contractValidationFailure(
    "invalid_command",
    "Unknown Agent Binding runtimeSource.",
  );
}

function isKnownAgentId(value: string): boolean {
  return isProviderCliAgentId(value) || value === "openai_api";
}

function isProviderCliAgentId(value: string): boolean {
  return value === "codex" || value === "claude" || value === "gemini";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function includesString(values: readonly string[], value: string): boolean {
  return values.includes(value);
}
