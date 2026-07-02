import type { StructuredProviderEvent } from "./structured-runtime-events.ts";

export function cancelAcpPermissionRequest(input: {
  serverRequestId: number | string;
  writeLine: (value: unknown) => void;
  onEvent: (event: StructuredProviderEvent) => void;
}): void {
  input.writeLine({
    jsonrpc: "2.0",
    id: input.serverRequestId,
    result: { outcome: { outcome: "cancelled" } },
  });
  input.onEvent({
    kind: "runtime_notice",
    level: "info",
    message: "ACP requested permission without answerable choices; Tide cancelled it.",
  });
}

export function writeUnsupportedAcpServerRequest(input: {
  serverRequestId: number | string;
  method: string;
  writeLine: (value: unknown) => void;
  onEvent: (event: StructuredProviderEvent) => void;
}): void {
  const message = `Tide does not support ACP server request "${input.method}".`;
  input.writeLine({
    jsonrpc: "2.0",
    id: input.serverRequestId,
    error: { code: -32601, message },
  });
  input.onEvent({ kind: "runtime_notice", level: "info", message });
}
