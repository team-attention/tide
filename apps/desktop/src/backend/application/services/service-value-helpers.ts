// Pure scalar/record value parsers and small preview/limit helpers used by the
// thread runtime service (mostly for Tide MCP / workbench command data coercion).
// Leaf-pure: no domain types, no service state. Extracted from
// thread-runtime-service.ts to keep the service focused on behavior.

export function commandName(command: string): string {
  const trimmed = command.trim();
  const parts = trimmed.split("/");
  return parts.at(-1) || trimmed || "provider";
}

export function setupLaunchPreview(command: string, args: string[], cwd: string): string {
  return `$ cd ${cwd}\n$ ${[command, ...args].join(" ")}\n`;
}

export function boundedTranscriptPreview(value: string): string {
  const maxLength = 8000;
  return value.length <= maxLength ? value : value.slice(value.length - maxLength);
}

export function boundedBrowserTextPreview(value: string): string {
  const maxLength = 64 * 1024;
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Provider Setup Surface failed.";
}

export function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function numberFromData(
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = data?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

export function optionalRawString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function fileByteLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), 128 * 1024);
  }
  return 64 * 1024;
}

export function commandByteLimit(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.floor(value), 512 * 1024);
  }
  return 64 * 1024;
}

export function commandTimeoutMs(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.min(Math.max(Math.floor(value), 1000), 120000);
  }
  return 30000;
}

export function fileTreeMaxDepth(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return Math.min(value, 12);
  }
  return 12;
}

export function fileTreeMaxEntries(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Math.min(value, 4000);
  }
  return 4000;
}

export function expectedOccurrences(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return Math.min(value, 1000);
  }
  return 1;
}

export function browserActionKindFromInput(
  value: unknown,
): "click" | "type_text" | undefined {
  return value === "click" || value === "type_text" ? value : undefined;
}

export function titleFromRelativePath(relativePath: string): string {
  const parts = relativePath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts.at(-1) ?? relativePath;
}

export function browserTitleFromUrl(url: string | undefined): string {
  if (url === undefined) {
    return "Browser";
  }
  try {
    const parsed = new URL(url);
    return parsed.hostname || "Browser";
  } catch {
    return "Browser";
  }
}

export function titleFromMessage(message: string): string {
  const title = message.trim().replace(/\s+/g, " ");
  if (title.length === 0) {
    return "New Thread";
  }
  if (title.length <= 80) {
    return title;
  }
  return `${title.slice(0, 77)}...`;
}
