export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return isPlainObject(value) && isJsonValue(value);
}

export function isJsonValue(value: unknown): value is JsonValue {
  return isJsonValueWithSeen(value, new Set<unknown>());
}

export function sanitizeJsonValue(
  value: unknown,
  seen: Set<unknown> = new Set<unknown>(),
): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return undefined;
    }
    seen.add(value);
    const sanitized = value
      .map((item) => sanitizeJsonValue(item, seen))
      .filter((item): item is JsonValue => item !== undefined);
    seen.delete(value);
    return sanitized;
  }
  if (!isPlainObject(value)) {
    return undefined;
  }
  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);
  const sanitized: JsonObject = {};
  for (const [key, child] of Object.entries(value)) {
    const sanitizedChild = sanitizeJsonValue(child, seen);
    if (sanitizedChild !== undefined) {
      sanitized[key] = sanitizedChild;
    }
  }
  seen.delete(value);

  return sanitized;
}

function isJsonValueWithSeen(
  value: unknown,
  seen: Set<unknown>,
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    const ok = value.every((item) => isJsonValueWithSeen(item, seen));
    seen.delete(value);
    return ok;
  }
  if (!isPlainObject(value)) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  const ok = Object.values(value).every((item) =>
    isJsonValueWithSeen(item, seen),
  );
  seen.delete(value);
  return ok;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
