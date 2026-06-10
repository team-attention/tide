// Generic JSON-record parsing helpers shared by the Agent Integration history
// connectors (each provider's session/transcript/rollout reader). Pure; no I/O.
// The adapter twins of the infra-side live-backend-json helpers, kept here so
// adapters never import infrastructure.

export function parseJsonObject(line: string): Record<string, unknown> | undefined {
  if (line.trim().length === 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(line);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function recordField(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return unknownRecord(value?.[key]);
}

export function stringField(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const field = value?.[key];
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

export function numberField(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const field = value?.[key];
  return typeof field === "number" ? field : undefined;
}

// True when a content item ({ text } / { input_text }) equals the expected text.
export function inputTextContentEquals(item: unknown, expected: string): boolean {
  const record = unknownRecord(item);
  if (record === undefined) {
    return false;
  }
  return (
    stringField(record, "text") === expected ||
    stringField(record, "input_text") === expected
  );
}

// Joins string/array-of-{text|input_text} content into readable text.
export function joinTextContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts = content
    .map((item) => {
      const record = unknownRecord(item);
      return record ? (stringField(record, "text") ?? stringField(record, "input_text")) : undefined;
    })
    .filter((value): value is string => typeof value === "string");
  return parts.length > 0 ? parts.join("") : undefined;
}

// Tool args/output can be large (full file contents, long command output). Keep
// the rendered body bounded so the transcript stays readable and light.
export function boundedToolText(text: string): string {
  const limit = 2000;
  return text.length > limit ? `${text.slice(0, limit)}\n… (${text.length - limit} more chars)` : text;
}
