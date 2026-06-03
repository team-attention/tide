import {
  createContractErrorPayload,
  type ContractErrorCode,
  type ContractErrorPayload,
} from "./errors.ts";
import {
  CONTRACT_VERSION,
  type ContractVersion,
  type ThreadId,
} from "./ids.ts";
import { isJsonObject } from "./json.ts";

export type BackendTransportKind = "message_port";

export type ConnectionState =
  | "starting"
  | "handshaking"
  | "connected"
  | "renderer_reconnecting"
  | "backend_disconnected"
  | "shutting_down";

export interface BackendHandshake {
  contractVersion: ContractVersion;
  backendInstanceId: string;
  startedAt: string;
  supportedTransports: BackendTransportKind[];
}

export interface RendererHandshake {
  contractVersion: ContractVersion;
  rendererInstanceId: string;
  activeThreadId?: ThreadId;
}

export interface BackendConnectionChangedPayload {
  state: ConnectionState;
  backendInstanceId?: string;
  reason?: ContractErrorPayload;
}

export interface BackendSnapshotRequestedPayload {
  activeThreadId?: ThreadId;
}

export interface BackendSnapshotReadyPayload {
  activeThreadId?: ThreadId;
}

export type ConnectionValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ContractErrorPayload };

export function validateBackendHandshake(
  value: unknown,
): ConnectionValidationResult<BackendHandshake> {
  if (!isJsonObject(value)) {
    return connectionValidationFailure(
      "invalid_event",
      "BackendHandshake must be a JSON object.",
    );
  }
  if (value.contractVersion === undefined) {
    return connectionValidationFailure(
      "invalid_event",
      "BackendHandshake requires Contract Version.",
    );
  }
  if (value.contractVersion !== CONTRACT_VERSION) {
    return connectionValidationFailure(
      "unsupported_contract_version",
      "Unsupported Contract Version.",
    );
  }
  if (!isNonEmptyString(value.backendInstanceId)) {
    return connectionValidationFailure(
      "invalid_event",
      "BackendHandshake requires backendInstanceId.",
    );
  }
  if (!isNonEmptyString(value.startedAt)) {
    return connectionValidationFailure(
      "invalid_event",
      "BackendHandshake requires startedAt.",
    );
  }
  if (
    !Array.isArray(value.supportedTransports) ||
    !value.supportedTransports.includes("message_port")
  ) {
    return connectionValidationFailure(
      "invalid_event",
      "BackendHandshake requires message_port support.",
    );
  }

  return { ok: true, value: value as unknown as BackendHandshake };
}

export function validateRendererHandshake(
  value: unknown,
): ConnectionValidationResult<RendererHandshake> {
  if (!isJsonObject(value)) {
    return connectionValidationFailure(
      "invalid_event",
      "RendererHandshake must be a JSON object.",
    );
  }
  if (value.contractVersion === undefined) {
    return connectionValidationFailure(
      "invalid_event",
      "RendererHandshake requires Contract Version.",
    );
  }
  if (value.contractVersion !== CONTRACT_VERSION) {
    return connectionValidationFailure(
      "unsupported_contract_version",
      "Unsupported Contract Version.",
    );
  }
  if (!isNonEmptyString(value.rendererInstanceId)) {
    return connectionValidationFailure(
      "invalid_event",
      "RendererHandshake requires rendererInstanceId.",
    );
  }
  if (value.activeThreadId !== undefined && !isNonEmptyString(value.activeThreadId)) {
    return connectionValidationFailure(
      "invalid_event",
      "RendererHandshake activeThreadId must be non-empty when present.",
    );
  }

  return { ok: true, value: value as unknown as RendererHandshake };
}

function connectionValidationFailure(
  code: ContractErrorCode,
  message: string,
): ConnectionValidationResult<never> {
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
