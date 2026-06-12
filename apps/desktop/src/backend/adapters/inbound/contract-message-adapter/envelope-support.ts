// Extracted from backend-contract-message-adapter.ts (spec: navigable-source-structure).

export function requestIdFromUnknown(message: unknown): string | undefined {
  if (
    typeof message === "object" &&
    message !== null &&
    "requestId" in message &&
    typeof message.requestId === "string" &&
    message.requestId.length > 0
  ) {
    return message.requestId;
  }

  return undefined;
}

export function defaultClock(): string {
  return new Date().toISOString();
}

export function defaultIdGenerator(): string {
  return `evt-${Math.random().toString(36).slice(2)}`;
}
