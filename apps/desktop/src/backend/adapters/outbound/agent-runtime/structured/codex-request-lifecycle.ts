import type { StructuredClientCallbacks } from "./structured-runtime-events.ts";

export const CODEX_REQUEST_TIMEOUT_MS = 15_000;

export interface PendingCodexResponse {
  onResult: (result: unknown) => void;
  onError?: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export function emitCodexDispatchFailure(input: {
  error: unknown;
  deliveryId?: string;
  exited: boolean;
  onEvent: StructuredClientCallbacks["onEvent"];
}): void {
  if (input.exited) return;
  input.onEvent({
    kind: "turn_completed",
    status: "failed",
    nativeStatus: "dispatch_error",
    deliveryId: input.deliveryId,
    notice: input.error instanceof Error ? input.error.message : "Codex dispatch failed.",
  });
}
