// Spec: docs_v2/specs/tide-mcp-stdio-bridge.md

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createTideMcpToolSurfaceAdapter } from "../src/backend/adapters/inbound/tide-mcp-tool-surface/tide-mcp-tool-surface-adapter.ts";
import {
  createTideMcpSocketRequestHandler,
} from "../src/backend/adapters/inbound/tide-mcp-server/tide-mcp-socket-bridge.ts";
import {
  createTideMcpJsonRpcHandler,
  runTideMcpLineDelimitedStdio,
  sessionFromTideMcpEnv,
} from "../src/backend/adapters/inbound/tide-mcp-server/tide-mcp-json-rpc.ts";
import {
  createThreadRuntimeService,
  type AgentRuntimeHandle,
  type AgentRuntimePort,
  type AgentRuntimeResumeInput,
  type AgentRuntimeStartInput,
  type ProviderReadinessCheckInput,
  type ProviderReadinessPort,
  type ProviderReadinessResult,
  type PtyTranscriptPort,
  type RawAgentFrame,
  type TerminalInput,
  type ThreadSeed,
} from "../src/backend/application/services/thread-runtime-service.ts";

const now = "2026-05-29T00:00:00.000Z";

test("backend_entrypoint_mcp_mode_reaches_stdio_bridge_without_electron_parent_port", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "src/backend/infrastructure/node/backend-entrypoint.ts",
      "mcp",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TIDE_SOCKET: "" },
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /TIDE_SOCKET is required/);
  assert.doesNotMatch(result.stderr, /Named export 'parentPort'/);
});

test("mcp_initialize_returns_tide_server_capabilities", async () => {
  const handler = createTideMcpJsonRpcHandler({
    listTools: () => [],
    callTool: async () => {
      throw new Error("not used");
    },
    session: () => ({
      runtimeId: "runtime-mcp",
      agentId: "codex",
      threadId: "thread-mcp",
    }),
  });

  const response = await handler.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {},
  });

  assert.equal(response?.jsonrpc, "2.0");
  assert.equal(response?.id, 1);
  assert.equal(response?.result.serverInfo.name, "tide");
  assert.deepEqual(response?.result.capabilities, { tools: {} });
});

test("mcp_tools_list_returns_backend_tool_definitions", async () => {
  const service = serviceWithActiveThread();
  const adapter = createTideMcpToolSurfaceAdapter({ service });
  const handler = createTideMcpJsonRpcHandler({
    listTools: () => adapter.listTools(),
    callTool: (input) => adapter.callTool(input),
    session: () => ({
      runtimeId: "runtime-mcp",
      agentId: "codex",
      threadId: "thread-mcp",
    }),
  });

  const response = await handler.handle({
    jsonrpc: "2.0",
    id: "list-1",
    method: "tools/list",
    params: {},
  });

  assert.equal(response?.id, "list-1");
  const toolNames = response?.result.tools.map((tool: { name: string }) => tool.name);
  assert.ok(toolNames?.includes("tide_observe_thread"));
  assert.ok(toolNames?.includes("tide_open_terminal"));
  assert.ok(toolNames?.includes("tide_run_terminal_command"));
});

test("mcp_tools_call_routes_to_thread_runtime_service", async () => {
  const service = serviceWithActiveThread();
  const adapter = createTideMcpToolSurfaceAdapter({ service });
  const handler = createTideMcpJsonRpcHandler({
    listTools: () => adapter.listTools(),
    callTool: (input) => adapter.callTool(input),
    session: () =>
      sessionFromTideMcpEnv({
        TIDE_RUNTIME_ID: "runtime-mcp",
        TIDE_AGENT_ID: "codex",
        TIDE_THREAD_ID: "thread-mcp",
      }),
  });

  const response = await handler.handle({
    jsonrpc: "2.0",
    id: "call-1",
    method: "tools/call",
    params: {
      name: "tide_observe_thread",
      arguments: {},
    },
  });

  assert.equal(response?.id, "call-1");
  assert.equal(response?.result.isError, undefined);
  assert.equal(response?.result.structuredContent.kind, "observe_thread");
  assert.equal(response?.result.structuredContent.threadId, "thread-mcp");
  assert.match(response?.result.content[0].text, /observe_thread/);
});

test("mcp_tools_call_service_error_returns_tool_error_content", async () => {
  const service = serviceWithActiveThread();
  const adapter = createTideMcpToolSurfaceAdapter({ service });
  const handler = createTideMcpJsonRpcHandler({
    listTools: () => adapter.listTools(),
    callTool: (input) => adapter.callTool(input),
    session: () => ({
      runtimeId: "missing-runtime",
      agentId: "codex",
      threadId: "thread-mcp",
    }),
  });

  const response = await handler.handle({
    jsonrpc: "2.0",
    id: "call-error",
    method: "tools/call",
    params: {
      name: "tide_observe_thread",
      arguments: {},
    },
  });

  assert.equal(response?.result.isError, true);
  assert.match(response?.result.content[0].text, /agent_runtime_unavailable/);
});

test("mcp_tools_call_without_runtime_env_returns_json_rpc_error", async () => {
  const handler = createTideMcpJsonRpcHandler({
    listTools: () => [],
    callTool: async () => {
      throw new Error("service should not be called without session env");
    },
    session: () => sessionFromTideMcpEnv({}),
  });

  const response = await handler.handle({
    jsonrpc: "2.0",
    id: "call-missing-env",
    method: "tools/call",
    params: {
      name: "tide_observe_thread",
      arguments: {},
    },
  });

  assert.equal(response?.error.code, -32002);
  assert.match(response?.error.message, /TIDE_RUNTIME_ID/);
});

test("line_delimited_stdio_runner_writes_one_json_response_per_request", async () => {
  const handler = createTideMcpJsonRpcHandler({
    listTools: () => [],
    callTool: async () => {
      throw new Error("not used");
    },
    session: () => ({
      runtimeId: "runtime-mcp",
      agentId: "codex",
    }),
  });
  const output: string[] = [];

  await runTideMcpLineDelimitedStdio({
    input: [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    ],
    writeLine: (line) => output.push(line),
    handler,
  });

  assert.equal(output.length, 2);
  assert.equal(JSON.parse(output[0]).id, 1);
  assert.equal(JSON.parse(output[1]).id, 2);
});

test("socket_request_handler_routes_to_live_tool_surface", async () => {
  const service = serviceWithActiveThread();
  const adapter = createTideMcpToolSurfaceAdapter({ service });
  const handler = createTideMcpSocketRequestHandler(adapter);

  const response = await handler.handle({
    jsonrpc: "2.0",
    id: "socket-call",
    method: "tide_mcp/call_tool",
    params: {
      session: {
        runtimeId: "runtime-mcp",
        agentId: "codex",
        threadId: "thread-mcp",
      },
      toolName: "tide_observe_thread",
      input: {},
    },
  });

  assert.equal(response.id, "socket-call");
  assert.ok("result" in response);
  const result = response.result as {
    ok: true;
    output: { threadId: string; kind: string };
  };
  assert.equal(result.ok, true);
  assert.equal(result.output.threadId, "thread-mcp");
  assert.equal(result.output.kind, "observe_thread");
});

function serviceWithActiveThread() {
  return createThreadRuntimeService({
    agentRuntimePort: new FakeAgentRuntimePort(),
    providerReadinessPort: new FakeProviderReadinessPort(),
    ptyTranscriptPort: new FakePtyTranscriptPort(),
    clock: () => now,
    idGenerator: sequentialIdGenerator("id"),
    initialThreads: [
      threadSeed("thread-mcp", {
        activeRuntimeHandle: {
          runtimeId: "runtime-mcp",
          threadId: "thread-mcp",
          agentId: "codex",
        },
      }),
    ],
  });
}

function threadSeed(
  threadId: string,
  overrides: Partial<ThreadSeed> = {},
): ThreadSeed {
  return {
    threadId,
    title: "MCP bridge thread",
    agentBinding: {
      agentId: "codex",
      runtimeSource: { kind: "provider_cli", integrationId: "codex" },
    },
    scope: { kind: "project", projectId: "tide", cwd: "/tmp/tide" },
    lifecycleState: "running",
    runtimeState: "running",
    lastKnownState: "running",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

class FakeAgentRuntimePort implements AgentRuntimePort {
  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    return {
      runtimeId: "runtime-start",
      threadId: input.threadId,
      agentId: "codex",
    };
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    return {
      runtimeId: "runtime-resume",
      threadId: input.threadId,
      agentId: "codex",
    };
  }

  async writeInput(
    _handle: AgentRuntimeHandle,
    _input: TerminalInput,
  ): Promise<void> {}

  async stop(_handle: AgentRuntimeHandle): Promise<void> {}
}

class FakeProviderReadinessPort implements ProviderReadinessPort {
  async check(input: ProviderReadinessCheckInput): Promise<ProviderReadinessResult> {
    return {
      agentId: input.agentId,
      ready: true,
      blockers: [],
    };
  }
}

class FakePtyTranscriptPort implements PtyTranscriptPort {
  frames: RawAgentFrame[] = [];

  async append(frame: RawAgentFrame): Promise<void> {
    this.frames.push(frame);
  }
}

function sequentialIdGenerator(prefix: string): () => string {
  let nextId = 1;
  return () => `${prefix}-${nextId++}`;
}
