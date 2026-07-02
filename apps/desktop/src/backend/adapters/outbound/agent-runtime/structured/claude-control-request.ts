import type { StructuredProviderEvent } from "./structured-runtime-events.ts";

export function writeUnsupportedClaudeControlRequest(input: {
  requestId: string;
  subtype: string;
  writeLine: (value: unknown) => void;
  onEvent: (event: StructuredProviderEvent) => void;
}): void {
  const message = `Tide does not support Claude control_request subtype "${input.subtype}".`;
  input.writeLine({
    type: "control_response",
    response: { subtype: "error", request_id: input.requestId, error: message },
  });
  input.onEvent({ kind: "runtime_notice", level: "info", message });
}
