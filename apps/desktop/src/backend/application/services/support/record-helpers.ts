import { optionalString } from "./service-value-helpers.ts";

// Pure record/array coercion helpers for unknown JSON-shaped values. Leaf-pure:
// no domain types, no service state. Extracted from thread-runtime-service.ts to
// keep the service focused on behavior.

export function cloneEnv(
  env: Record<string, string> | undefined,
): Record<string, string> | undefined {
  return env === undefined ? undefined : { ...env };
}

export function recordOfStrings(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function shallowRecordEqual(
  left: Record<string, string> | undefined,
  right: Record<string, string> | undefined,
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([key, value]) => right?.[key] === value);
}

export function stringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  return value === undefined ? undefined : optionalString(value[field]);
}

export function literalStringField(
  value: Record<string, unknown> | undefined,
  field: string,
): string | undefined {
  const candidate = value?.[field];
  return typeof candidate === "string" ? candidate : undefined;
}

export function recordField(
  value: Record<string, unknown> | undefined,
  field: string,
): Record<string, unknown> | undefined {
  const candidate = value?.[field];
  if (
    candidate === undefined ||
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    return undefined;
  }
  return candidate as Record<string, unknown>;
}

export function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}
