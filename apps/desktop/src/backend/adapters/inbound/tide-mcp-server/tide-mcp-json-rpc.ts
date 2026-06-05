import type {
  ServiceResult,
  TideMcpSessionRef,
  TideMcpToolCallInput,
  TideMcpToolCallResult,
  TideMcpToolDefinition,
} from "../../../application/services/thread-runtime-service.ts";

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
}

export type JsonRpcResponse =
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      result: Record<string, unknown>;
    }
  | {
      jsonrpc: "2.0";
      id: JsonRpcId;
      error: {
        code: number;
        message: string;
      };
    };

export interface TideMcpJsonRpcHandler {
  handle(message: unknown): Promise<JsonRpcResponse | undefined>;
}

export interface CreateTideMcpJsonRpcHandlerInput {
  listTools(): TideMcpToolDefinition[] | Promise<TideMcpToolDefinition[]>;
  callTool(
    input: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>>;
  session(): TideMcpSessionRef | undefined;
}

export interface TideMcpRuntimeEnv {
  TIDE_RUNTIME_ID?: string;
  TIDE_AGENT_ID?: string;
  TIDE_THREAD_ID?: string;
}

export interface RunTideMcpLineDelimitedStdioInput {
  input: Iterable<string> | AsyncIterable<string>;
  writeLine(line: string): void | Promise<void>;
  handler: TideMcpJsonRpcHandler;
}

export function createTideMcpJsonRpcHandler(
  input: CreateTideMcpJsonRpcHandlerInput,
): TideMcpJsonRpcHandler {
  return new BackendTideMcpJsonRpcHandler(input);
}

export async function runTideMcpLineDelimitedStdio(
  input: RunTideMcpLineDelimitedStdioInput,
): Promise<void> {
  for await (const line of input.input) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      await input.writeLine(
        JSON.stringify(
          jsonRpcError(
            null,
            -32700,
            error instanceof Error ? `Parse error: ${error.message}` : "Parse error.",
          ),
        ),
      );
      continue;
    }

    // A transient backend socket error (e.g. the Backend restarted and its unix
    // socket briefly went away) must not crash the stdio bridge process: the
    // agent's MCP client does not respawn a dead server, so the whole Tide tool
    // surface would vanish for that session permanently. Reply with a JSON-RPC
    // error and keep the loop alive so the next request reconnects to the
    // stable-path socket once the Backend is back.
    let response: JsonRpcResponse | undefined;
    try {
      response = await input.handler.handle(parsed);
    } catch (error) {
      response = jsonRpcError(
        jsonRpcIdOf(parsed),
        -32603,
        error instanceof Error ? error.message : "Tide MCP request failed.",
      );
    }
    if (response !== undefined) {
      await input.writeLine(JSON.stringify(response));
    }
  }
}

export function sessionFromTideMcpEnv(
  env: TideMcpRuntimeEnv,
): TideMcpSessionRef | undefined {
  if (env.TIDE_RUNTIME_ID === undefined || env.TIDE_AGENT_ID === undefined) {
    return undefined;
  }

  return {
    runtimeId: env.TIDE_RUNTIME_ID,
    agentId: env.TIDE_AGENT_ID as TideMcpSessionRef["agentId"],
    threadId: env.TIDE_THREAD_ID,
  };
}

class BackendTideMcpJsonRpcHandler implements TideMcpJsonRpcHandler {
  private readonly listTools: CreateTideMcpJsonRpcHandlerInput["listTools"];
  private readonly callTool: CreateTideMcpJsonRpcHandlerInput["callTool"];
  private readonly session: CreateTideMcpJsonRpcHandlerInput["session"];

  constructor(input: CreateTideMcpJsonRpcHandlerInput) {
    this.listTools = input.listTools;
    this.callTool = input.callTool;
    this.session = input.session;
  }

  async handle(message: unknown): Promise<JsonRpcResponse | undefined> {
    const request = requestObject(message);
    if (request === undefined) {
      return jsonRpcError(null, -32600, "Invalid JSON-RPC request.");
    }

    const id = request.id ?? null;
    const method = request.method ?? "";
    switch (method) {
      case "initialize":
        return jsonRpcResult(id, initializeResult());
      // MCP keepalive: a client (e.g. codex's rmcp client) pings the server and
      // treats no/erroring reply as a dead connection — then it stops dispatching
      // tool calls and the turn hangs "Working". Always answer ping with an empty
      // result so the connection stays healthy.
      case "ping":
        return jsonRpcResult(id, {});
      case "tools/list":
        return jsonRpcResult(id, {
          tools: (await this.listTools()).map(mcpToolDefinition),
        });
      case "tools/call":
        return this.handleToolCall(id, request.params);
      default:
        // Notifications (no response expected) must never get a reply — answering a
        // notification with an error response can desync a strict client.
        if (method.startsWith("notifications/")) {
          return undefined;
        }
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  private async handleToolCall(
    id: JsonRpcId,
    params: unknown,
  ): Promise<JsonRpcResponse> {
    const parsed = parseToolCallParams(params);
    if (parsed === undefined) {
      return jsonRpcError(id, -32602, "tools/call requires a tool name.");
    }

    const session = this.session();
    if (session === undefined) {
      return jsonRpcError(
        id,
        -32002,
        "TIDE_RUNTIME_ID and TIDE_AGENT_ID are required for Tide MCP tool calls.",
      );
    }

    const result = await this.callTool({
      session,
      toolName: parsed.name as TideMcpToolCallInput["toolName"],
      input: parsed.arguments,
    });
    if (!result.ok) {
      return jsonRpcResult(id, mcpToolErrorResult(result.error));
    }

    return jsonRpcResult(id, mcpToolSuccessResult(result.output));
  }
}

function initializeResult(): Record<string, unknown> {
  return {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: {
      name: "tide",
      version: "0.1.0",
    },
    instructions:
      "You are running inside Tide. Use Tide MCP tools for Thread, Workbench, Browser Pane, File, Diff, and Terminal Pane context.",
  };
}

function mcpToolDefinition(tool: TideMcpToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

function parseToolCallParams(
  params: unknown,
): { name: string; arguments: Record<string, unknown> } | undefined {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }
  const fields = params as Record<string, unknown>;
  if (typeof fields.name !== "string" || fields.name.trim().length === 0) {
    return undefined;
  }
  const toolArguments = fields.arguments;
  return {
    name: fields.name,
    arguments:
      toolArguments !== null &&
      typeof toolArguments === "object" &&
      !Array.isArray(toolArguments)
        ? (toolArguments as Record<string, unknown>)
        : {},
  };
}

function mcpToolSuccessResult(output: unknown): Record<string, unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function mcpToolErrorResult(error: {
  code: string;
  message: string;
}): Record<string, unknown> {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(error) }],
    structuredContent: { error },
  };
}

function requestObject(value: unknown): JsonRpcRequest | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const request = value as JsonRpcRequest;
  if (request.jsonrpc !== undefined && request.jsonrpc !== "2.0") {
    return undefined;
  }
  if (typeof request.method !== "string") {
    return undefined;
  }
  if (
    request.id !== undefined &&
    request.id !== null &&
    typeof request.id !== "string" &&
    typeof request.id !== "number"
  ) {
    return undefined;
  }
  return request;
}

function jsonRpcIdOf(value: unknown): JsonRpcId {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" || typeof id === "number" ? id : null;
}

function jsonRpcResult(
  id: JsonRpcId,
  result: Record<string, unknown>,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
): JsonRpcResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}
