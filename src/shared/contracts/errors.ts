import type { JsonObject } from "./json.ts";
import { isJsonObject, sanitizeJsonValue } from "./json.ts";

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

export const CONTRACT_ERROR_CODES: ContractErrorCode[] = [
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
