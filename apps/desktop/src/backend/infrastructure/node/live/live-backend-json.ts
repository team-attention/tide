// Pure JSON/record coercion helpers for parsing provider-owned JSONL history and
// hook payloads. Leaf-pure. Extracted from live-backend.ts.

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

export function recordField(
  value: Record<string, unknown> | undefined,
  key: string,
): Record<string, unknown> | undefined {
  const field = value?.[key];
  if (field !== null && typeof field === "object" && !Array.isArray(field)) {
    return field as Record<string, unknown>;
  }
  return undefined;
}

export function unknownRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
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

export function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function inputTextContentEquals(
  item: unknown,
  expectedUserMessage: string,
): boolean {
  const record = unknownRecord(item);
  if (record === undefined) {
    return false;
  }
  return (
    stringField(record, "text") === expectedUserMessage ||
    stringField(record, "input_text") === expectedUserMessage
  );
}

export function claudeAssistantTextContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.length > 0) {
    return content;
  }
  if (!Array.isArray(content)) {
    return undefined;
  }

  const textParts = content
    .map((item) => stringField(unknownRecord(item), "text"))
    .filter((text): text is string => text !== undefined);
  return textParts.length > 0 ? textParts.join("\n") : undefined;
}

// Extended-thinking content from a claude assistant message: content items of
// type "thinking" carry a `thinking` field (not `text`). Returns the joined
// thinking text, or undefined when the turn has no thinking content.
export function claudeThinkingText(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }
  const parts: string[] = [];
  for (const item of content) {
    const record = unknownRecord(item);
    if (record?.type !== "thinking") {
      continue;
    }
    const text = stringField(record, "thinking") ?? stringField(record, "text");
    if (text !== undefined && text.trim().length > 0) {
      parts.push(text);
    }
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}
