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
    requestId: options.requestId,
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function includesString(values: readonly string[], value: string): boolean {
  return values.includes(value);
}
