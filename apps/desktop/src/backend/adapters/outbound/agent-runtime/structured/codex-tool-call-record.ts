export interface CodexToolCallRecord {
  itemId: string;
  sourceRef: string;
  payload: Record<string, unknown>;
  body: string;
}

export type CodexToolCallStatus = "pending" | "complete" | "failed";

export function codexToolCallRecordFromItem(input: {
  item: Record<string, unknown>;
  runtimeId: string;
  sequence: number;
  status: CodexToolCallStatus;
}): CodexToolCallRecord | undefined {
  const itemType = stringField(input.item, "type") ?? stringField(input.item, "itemType");
  const itemId = codexToolItemId(input.item, String(input.sequence));
  const blockId = `structured:${input.runtimeId}:${input.sequence}:${itemId}`;

  if (itemType === "commandExecution") {
    const command = stringField(input.item, "command") ?? "";
    return {
      itemId,
      sourceRef: blockId,
      payload: {
        type: "tool_call",
        toolName: "shell",
        callId: itemId,
        arguments: command,
        body: bounded(command),
        status: input.status,
        blockId,
        sourceRuntimeId: input.runtimeId,
      },
      body: bounded(command),
    };
  }
  if (itemType === "mcpToolCall") {
    const server = stringField(input.item, "server") ?? "mcp";
    const tool = stringField(input.item, "tool") ?? "tool";
    const argumentsText = JSON.stringify(input.item.arguments ?? {});
    return {
      itemId,
      sourceRef: blockId,
      payload: {
        type: "tool_call",
        toolName: `${server}.${tool}`,
        callId: itemId,
        arguments: argumentsText,
        body: bounded(argumentsText),
        status: input.status,
        blockId,
        sourceRuntimeId: input.runtimeId,
      },
      body: bounded(argumentsText),
    };
  }
  if (itemType === "webSearch") {
    const query = stringField(input.item, "query") ?? "";
    return {
      itemId,
      sourceRef: blockId,
      payload: {
        type: "tool_call",
        toolName: "web_search",
        callId: itemId,
        arguments: query,
        body: query,
        status: input.status,
        blockId,
        sourceRuntimeId: input.runtimeId,
      },
      body: query,
    };
  }
  return undefined;
}

export function codexToolNameFromItem(item: Record<string, unknown>): string | undefined {
  const itemType = stringField(item, "type") ?? stringField(item, "itemType");
  if (itemType === "commandExecution") return "shell";
  if (itemType === "mcpToolCall") {
    const server = stringField(item, "server") ?? "mcp";
    const tool = stringField(item, "tool") ?? "tool";
    return `${server}.${tool}`;
  }
  if (itemType === "webSearch") return "web_search";
  return undefined;
}

export function codexToolItemId(item: Record<string, unknown>, fallback: string): string {
  const explicit = stringField(item, "id");
  if (explicit !== undefined) return explicit;
  const itemType = stringField(item, "type") ?? stringField(item, "itemType");
  if (itemType === "commandExecution") return `command:${stringField(item, "command") ?? ""}`;
  if (itemType === "mcpToolCall") {
    const server = stringField(item, "server") ?? "mcp";
    const tool = stringField(item, "tool") ?? "tool";
    return `mcp:${server}:${tool}:${jsonText(item.arguments ?? {})}`;
  }
  if (itemType === "webSearch") return `webSearch:${stringField(item, "query") ?? ""}`;
  return fallback;
}

export function isCodexVisibleToolItem(item: Record<string, unknown>): boolean {
  const itemType = stringField(item, "type") ?? stringField(item, "itemType");
  return itemType === "commandExecution" || itemType === "mcpToolCall" || itemType === "webSearch";
}

export function isCodexAppsMcpToolItem(item: Record<string, unknown>): boolean {
  const itemType = stringField(item, "type") ?? stringField(item, "itemType");
  if (itemType !== "mcpToolCall") {
    return false;
  }
  const server = stringField(item, "server") ?? "";
  const namespace = stringField(item, "namespace") ?? "";
  const tool = stringField(item, "tool") ?? "";
  return server === "codex_apps" || namespace.startsWith("mcp__codex_apps") || tool.startsWith("codex_apps.");
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function bounded(text: string): string {
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}
