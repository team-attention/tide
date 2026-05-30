import { existsSync, unlinkSync } from "node:fs";
import net from "node:net";

import {
  createTideMcpJsonRpcHandler,
  runTideMcpLineDelimitedStdio,
  sessionFromTideMcpEnv,
  type RunTideMcpLineDelimitedStdioInput,
  type TideMcpRuntimeEnv,
} from "./tide-mcp-json-rpc.ts";
import type {
  ServiceResult,
  TideMcpSessionRef,
  TideMcpToolCallInput,
  TideMcpToolCallResult,
  TideMcpToolDefinition,
} from "../../../application/services/thread-runtime-service.ts";
import type { TideMcpToolSurfaceAdapter } from "../tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts";

export interface TideMcpSocketServer {
  readonly socketPath: string;
  listen(): Promise<void>;
  close(): Promise<void>;
}

export interface CreateTideMcpSocketServerInput {
  socketPath: string;
  adapter: TideMcpToolSurfaceAdapter;
}

export interface CreateTideMcpSocketClientCallbacksInput {
  socketPath: string;
  session?: TideMcpSessionRef;
}

export interface RunTideMcpSocketBackedLineDelimitedStdioInput {
  socketPath: string;
  env: TideMcpRuntimeEnv;
  input: RunTideMcpLineDelimitedStdioInput["input"];
  writeLine: RunTideMcpLineDelimitedStdioInput["writeLine"];
}

type InternalMcpResponse =
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      result: unknown;
    }
  | {
      jsonrpc: "2.0";
      id: string | number | null;
      error: {
        code: number;
        message: string;
      };
    };

export interface TideMcpSocketRequestHandler {
  handle(request: unknown): Promise<InternalMcpResponse>;
}

export function createTideMcpSocketServer(
  input: CreateTideMcpSocketServerInput,
): TideMcpSocketServer {
  return new NodeTideMcpSocketServer(input);
}

export function createTideMcpSocketRequestHandler(
  adapter: TideMcpToolSurfaceAdapter,
): TideMcpSocketRequestHandler {
  return new BackendTideMcpSocketRequestHandler(adapter);
}

export function createTideMcpSocketClientCallbacks(
  input: CreateTideMcpSocketClientCallbacksInput,
): {
  listTools(): Promise<TideMcpToolDefinition[]>;
  callTool(
    toolCall: TideMcpToolCallInput,
  ): Promise<ServiceResult<TideMcpToolCallResult>>;
} {
  return {
    async listTools() {
      const result = await sendInternalRequest(input.socketPath, {
        jsonrpc: "2.0",
        id: nextRequestId(),
        method: "tide_mcp/list_tools",
        params: {},
      });
      const tools = recordField(result)?.tools;
      return Array.isArray(tools) ? (tools as TideMcpToolDefinition[]) : [];
    },
    async callTool(toolCall) {
      const result = await sendInternalRequest(input.socketPath, {
        jsonrpc: "2.0",
        id: nextRequestId(),
        method: "tide_mcp/call_tool",
        params: {
          session: toolCall.session ?? input.session,
          toolName: toolCall.toolName,
          input: toolCall.input,
        },
      });
      return result as ServiceResult<TideMcpToolCallResult>;
    },
  };
}

export async function runTideMcpSocketBackedLineDelimitedStdio(
  input: RunTideMcpSocketBackedLineDelimitedStdioInput,
): Promise<void> {
  const callbacks = createTideMcpSocketClientCallbacks({
    socketPath: input.socketPath,
  });
  const handler = createTideMcpJsonRpcHandler({
    listTools: callbacks.listTools,
    callTool: callbacks.callTool,
    session: () => sessionFromTideMcpEnv(input.env),
  });

  await runTideMcpLineDelimitedStdio({
    input: input.input,
    writeLine: input.writeLine,
    handler,
  });
}

class NodeTideMcpSocketServer implements TideMcpSocketServer {
  readonly socketPath: string;
  private readonly requestHandler: TideMcpSocketRequestHandler;
  private readonly server = net.createServer((socket) => {
    this.handleConnection(socket);
  });

  constructor(input: CreateTideMcpSocketServerInput) {
    this.socketPath = input.socketPath;
    this.requestHandler = createTideMcpSocketRequestHandler(input.adapter);
  }

  listen(): Promise<void> {
    if (existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    return new Promise((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, () => {
        this.server.off("error", reject);
        resolve();
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close((error) => {
        if (existsSync(this.socketPath)) {
          unlinkSync(this.socketPath);
        }
        if (error !== undefined) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        void this.handleLine(socket, line);
      }
    });
  }

  private async handleLine(socket: net.Socket, line: string): Promise<void> {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    let request: unknown;
    try {
      request = JSON.parse(trimmed);
    } catch (error) {
      socket.write(
        `${JSON.stringify(internalError(null, -32700, errorMessage(error)))}\n`,
      );
      return;
    }

    const response = await this.requestHandler.handle(request);
    socket.write(`${JSON.stringify(response)}\n`);
  }
}

class BackendTideMcpSocketRequestHandler implements TideMcpSocketRequestHandler {
  private readonly adapter: TideMcpToolSurfaceAdapter;

  constructor(adapter: TideMcpToolSurfaceAdapter) {
    this.adapter = adapter;
  }

  async handle(request: unknown): Promise<InternalMcpResponse> {
    const fields = recordField(request);
    const id = jsonRpcId(fields?.id);
    const method = typeof fields?.method === "string" ? fields.method : "";
    const params = recordField(fields?.params);

    switch (method) {
      case "tide_mcp/list_tools":
        return internalResult(id, { tools: this.adapter.listTools() });
      case "tide_mcp/call_tool": {
        const parsed = parseInternalToolCall(params);
        if (parsed === undefined) {
          return internalError(id, -32602, "Invalid Tide MCP socket tool call.");
        }
        const result = await this.adapter.callTool(parsed);
        return internalResult(id, result);
      }
      default:
        return internalError(id, -32601, `Method not found: ${method}`);
    }
  }
}

function parseInternalToolCall(
  params: Record<string, unknown> | undefined,
): TideMcpToolCallInput | undefined {
  const session = recordField(params?.session);
  const runtimeId = stringField(session?.runtimeId);
  const agentId = stringField(session?.agentId);
  const toolName = stringField(params?.toolName);
  if (runtimeId === undefined || agentId === undefined || toolName === undefined) {
    return undefined;
  }

  return {
    session: {
      runtimeId,
      agentId: agentId as TideMcpSessionRef["agentId"],
      threadId: stringField(session?.threadId),
    },
    toolName: toolName as TideMcpToolCallInput["toolName"],
    input: recordField(params?.input) ?? {},
  };
}

function sendInternalRequest(
  socketPath: string,
  request: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";

    socket.setEncoding("utf8");
    socket.once("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex);
      socket.end();
      try {
        const response = JSON.parse(line) as InternalMcpResponse;
        if ("error" in response) {
          reject(new Error(response.error.message));
          return;
        }
        resolve(response.result);
      } catch (error) {
        reject(error);
      }
    });
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(request)}\n`);
    });
  });
}

let nextId = 1;

function nextRequestId(): string {
  const id = `mcp-socket-${nextId}`;
  nextId += 1;
  return id;
}

function internalResult(
  id: string | number | null,
  result: unknown,
): InternalMcpResponse {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function internalError(
  id: string | number | null,
  code: number,
  message: string,
): InternalMcpResponse {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

function jsonRpcId(value: unknown): string | number | null {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }
  return null;
}

function recordField(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Tide MCP socket bridge failed.";
}
