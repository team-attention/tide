import {
  type BackendCommandEnvelope,
  type BackendEventEnvelope,
  type ContractErrorPayload,
  type ContractValidationResult,
  validateBackendCommandEnvelope,
  validateBackendEventEnvelope,
} from "../../../../shared/contracts/index.ts";

export interface BackendMessagePortLike {
  postMessage(message: unknown): void;
  addEventListener?(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  removeEventListener?(
    type: "message",
    listener: (event: { data: unknown }) => void,
  ): void;
  start?(): void;
}

export interface MessagePortBackendClient {
  postCommandEnvelope(
    message: unknown,
  ): ContractValidationResult<BackendCommandEnvelope>;
  disconnect(): void;
}

export interface CreateMessagePortBackendClientInput {
  port: BackendMessagePortLike;
  onEvent?: (event: BackendEventEnvelope) => void;
  onInvalidEvent?: (error: ContractErrorPayload) => void;
}

export function createMessagePortBackendClient(
  input: CreateMessagePortBackendClientInput,
): MessagePortBackendClient {
  const listener = (event: { data: unknown }) => {
    const validated = validateBackendEventEnvelope(event.data);
    if (validated.ok) {
      input.onEvent?.(validated.value);
      return;
    }

    input.onInvalidEvent?.(validated.error);
  };

  input.port.addEventListener?.("message", listener);
  input.port.start?.();

  return {
    postCommandEnvelope(
      message: unknown,
    ): ContractValidationResult<BackendCommandEnvelope> {
      const validated = validateBackendCommandEnvelope(message);
      if (!validated.ok) {
        return validated;
      }

      input.port.postMessage(validated.value);
      return validated;
    },

    disconnect(): void {
      input.port.removeEventListener?.("message", listener);
    },
  };
}
