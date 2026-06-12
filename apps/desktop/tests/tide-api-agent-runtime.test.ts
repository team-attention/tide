// Spec: docs_v2/specs/tide-api-agent-runtime.md
// Spec: docs_v2/specs/tide-api-agent-tool-calls.md

import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentRuntimeRouterPort,
  createProviderReadinessRouterPort,
} from "../src/backend/adapters/outbound/agent-runtime/runtime-ports/agent-runtime-router-port.ts";
import {
  buildOpenAiFunctionToolsFromTideTools,
  createOpenAiApiAgentRuntimePort,
  createOpenAiProviderAccountReadinessPort,
  createOpenAiResponsesClient,
  type OpenAiFunctionCall,
  type OpenAiFunctionTool,
  type OpenAiApiAgentRuntimeFrame,
  type OpenAiProviderAccount,
  type OpenAiResponseInput,
} from "../src/backend/adapters/outbound/agent-runtime/runtime-ports/openai-api-agent-runtime-port.ts";
import type {
  AgentRuntimeHandle,
  AgentRuntimeResumeInput,
  AgentRuntimeStartInput,
  TerminalInput,
} from "../src/backend/application/domains/agent-runtime/agent-runtime.ts";
import type {
  ProviderReadinessCheckInput,
  ProviderReadinessResult,
} from "../src/backend/application/domains/provider-readiness/provider-readiness.ts";
import type { AgentRuntimePort } from "../src/backend/application/ports/outbound/agent-runtime-port.ts";
import type { ProviderReadinessPort } from "../src/backend/application/ports/outbound/provider-readiness-port.ts";

const now = "2026-05-29T00:00:00.000Z";

test("openai_provider_account_readiness_requires_api_key", async () => {
  const missing = createOpenAiProviderAccountReadinessPort({
    readAccount: () => undefined,
  });
  const blocked = await missing.check({
    agentId: "openai_api",
    launchOptions: { model: "gpt-5.5" },
  });

  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.blockers, [
    {
      kind: "provider_account_required",
      message: "OpenAI Provider Account setup is required before starting this Tide API Agent.",
      scope: "provider",
      action: "open_provider",
    },
  ]);

  const ready = createOpenAiProviderAccountReadinessPort({
    readAccount: () => ({ apiKey: "sk-test" }),
  });

  assert.deepEqual(await ready.check({ agentId: "openai_api" }), {
    agentId: "openai_api",
    ready: true,
    blockers: [],
  });
});

test("agent_runtime_router_dispatches_openai_api_to_tide_api_runtime", async () => {
  const providerCliRuntime = new RecordingAgentRuntimePort("provider-runtime");
  const tideApiRuntime = new RecordingAgentRuntimePort("tide-api-runtime");
  const router = createAgentRuntimeRouterPort({
    providerCliRuntime,
    tideApiRuntime,
  });

  const handle = await router.start({
    threadId: "thread-openai",
    agentBinding: {
      agentId: "openai_api",
      runtimeSource: { kind: "tide_api", provider: "openai" },
    },
    launchOptions: { model: "gpt-5.5" },
  });
  await router.writeInput(handle, {
    kind: "composer_input",
    value: "hello",
    submittedAt: now,
  });

  assert.equal(handle.runtimeId, "tide-api-runtime-1");
  assert.equal(tideApiRuntime.starts.length, 1);
  assert.equal(tideApiRuntime.inputs.length, 1);
  assert.equal(providerCliRuntime.starts.length, 0);
});

test("provider_readiness_router_keeps_codex_on_provider_cli_readiness", async () => {
  const providerCliReadiness = new RecordingReadinessPort({
    agentId: "codex",
    ready: true,
    blockers: [],
  });
  const tideApiReadiness = new RecordingReadinessPort({
    agentId: "openai_api",
    ready: false,
    blockers: [],
  });
  const router = createProviderReadinessRouterPort({
    providerCliReadiness,
    tideApiReadiness,
  });

  const result = await router.check({
    agentId: "codex",
    launchOptions: { model: "gpt-5.5" },
  });

  assert.equal(result.ready, true);
  assert.equal(providerCliReadiness.inputs.length, 1);
  assert.equal(tideApiReadiness.inputs.length, 0);
});

test("openai_api_runtime_sends_response_request_and_emits_structured_message_frame", async () => {
  const client = new RecordingOpenAiResponseClient({
    responseId: "resp-1",
    outputText: "Hello from OpenAI",
    raw: { id: "resp-1", output_text: "Hello from OpenAI" },
  });
  const frames: OpenAiApiAgentRuntimeFrame[] = [];
  const runtime = createOpenAiApiAgentRuntimePort({
    readAccount: () => ({ apiKey: "sk-test", defaultModel: "gpt-5.5" }),
    client,
    clock: () => now,
    idGenerator: sequentialIdGenerator("runtime"),
    onRawFrame: (frame) => frames.push(frame),
  });

  const handle = await runtime.start({
    threadId: "thread-openai",
    agentBinding: {
      agentId: "openai_api",
      runtimeSource: { kind: "tide_api", provider: "openai" },
    },
    launchOptions: { model: "gpt-5.5" },
  });
  await runtime.writeInput(handle, {
    kind: "composer_input",
    value: "Build the API-backed thread",
    submittedAt: now,
  });

  assert.equal(client.inputs.length, 1);
  assert.equal(client.inputs[0].model, "gpt-5.5");
  assert.equal(client.inputs[0].input, "Build the API-backed thread");
  assert.equal(frames.length, 1);
  assert.equal(frames[0].source, "structured_batch");
  assert.equal(frames[0].payloadKind, "json");
  assert.deepEqual(frames[0].payload, {
    type: "message",
    role: "agent",
    status: "complete",
    blockId: "openai:thread-openai:resp-1",
    body: "Hello from OpenAI",
    responseId: "resp-1",
  });
});

test("openai_function_tools_are_built_from_tide_tool_definitions", () => {
  const tools = buildOpenAiFunctionToolsFromTideTools([
    {
      name: "tide_observe_thread",
      description: "Observe Thread state.",
      inputSchema: {
        type: "object",
        properties: {
          detail: { type: "string", enum: ["compact", "full"] },
        },
      },
    },
  ]);

  assert.deepEqual(tools, [
    {
      type: "function",
      name: "tide_observe_thread",
      description: "Observe Thread state.",
      parameters: {
        type: "object",
        properties: {
          detail: { type: "string", enum: ["compact", "full"] },
        },
      },
      strict: false,
    },
  ]);
});

test("openai_api_runtime_executes_tide_tool_call_and_emits_tool_frames", async () => {
  const toolCall: OpenAiFunctionCall = {
    callId: "call-observe-thread",
    name: "tide_observe_thread",
    argumentsJson: "{\"detail\":\"compact\"}",
    raw: {
      type: "function_call",
      call_id: "call-observe-thread",
      name: "tide_observe_thread",
      arguments: "{\"detail\":\"compact\"}",
    },
  };
  const client = new RecordingOpenAiResponseClient([
    {
      responseId: "resp-tool",
      outputText: "",
      raw: { id: "resp-tool", output: [toolCall.raw] },
      outputItems: [toolCall.raw],
      functionCalls: [toolCall],
      reasoningItems: [{ type: "reasoning", id: "reason-1", summary: [] }],
    },
    {
      responseId: "resp-final",
      outputText: "I observed the Thread.",
      raw: { id: "resp-final", output_text: "I observed the Thread." },
      outputItems: [],
      functionCalls: [],
      reasoningItems: [],
    },
  ]);
  const frames: OpenAiApiAgentRuntimeFrame[] = [];
  const toolExecutions: Array<{ toolName: string; input?: Record<string, unknown> }> = [];
  const runtime = createOpenAiApiAgentRuntimePort({
    readAccount: () => ({ apiKey: "sk-test", defaultModel: "gpt-5.5" }),
    client,
    clock: () => now,
    idGenerator: sequentialIdGenerator("runtime"),
    listTools: () => [
      {
        name: "tide_observe_thread",
        description: "Observe Thread state.",
        inputSchema: { type: "object", properties: { detail: { type: "string" } } },
      },
    ],
    executeTool: async (input) => {
      toolExecutions.push({ toolName: input.toolName, input: input.input });
      return {
        ok: true,
        output: {
          kind: "observe_thread",
          threadId: input.session.threadId,
          agentId: input.session.agentId,
        },
      };
    },
    onRawFrame: (frame) => frames.push(frame),
  });

  const handle = await runtime.start({
    threadId: "thread-openai-tools",
    agentBinding: {
      agentId: "openai_api",
      runtimeSource: { kind: "tide_api", provider: "openai" },
    },
    launchOptions: { model: "gpt-5.5" },
  });
  await runtime.writeInput(handle, {
    kind: "composer_input",
    value: "Inspect the Thread",
    submittedAt: now,
  });

  assert.equal(client.inputs.length, 2);
  assert.equal(client.inputs[0].input, "Inspect the Thread");
  assert.equal(client.inputs[0].tools?.[0].name, "tide_observe_thread");
  assert.equal(client.inputs[1].previousResponseId, "resp-tool");
  assert.deepEqual(toolExecutions, [
    { toolName: "tide_observe_thread", input: { detail: "compact" } },
  ]);

  assert.equal(Array.isArray(client.inputs[1].input), true);
  const followUpInput = client.inputs[1].input as Array<Record<string, unknown>>;
  assert.equal(followUpInput[0].type, "reasoning");
  assert.equal(followUpInput[1].type, "function_call");
  assert.deepEqual(followUpInput[2], {
    type: "function_call_output",
    call_id: "call-observe-thread",
    output: JSON.stringify({
      ok: true,
      output: {
        kind: "observe_thread",
        threadId: "thread-openai-tools",
        agentId: "openai_api",
      },
    }),
  });

  assert.deepEqual(
    frames.map((frame) => frame.payload.type),
    ["tool_call", "tool_result", "message"],
  );
  assert.equal(frames[0].payload.toolName, "tide_observe_thread");
  assert.equal(frames[0].payload.callId, "call-observe-thread");
  assert.deepEqual(frames[0].payload.arguments, { detail: "compact" });
  assert.equal(frames[1].payload.ok, true);
  assert.equal(frames[2].body, "I observed the Thread.");
});

test("openai_api_runtime_stops_after_configured_tool_rounds", async () => {
  const client = new RecordingOpenAiResponseClient([
    toolCallResponse("resp-1", "call-1"),
    toolCallResponse("resp-2", "call-2"),
  ]);
  const frames: OpenAiApiAgentRuntimeFrame[] = [];
  let executionCount = 0;
  const runtime = createOpenAiApiAgentRuntimePort({
    readAccount: () => ({ apiKey: "sk-test" }),
    client,
    maxToolRounds: 1,
    executeTool: async () => {
      executionCount += 1;
      return { ok: true, output: { kind: "observe_thread" } };
    },
    onRawFrame: (frame) => frames.push(frame),
  });

  const handle = await runtime.start({
    threadId: "thread-openai-limit",
    agentBinding: {
      agentId: "openai_api",
      runtimeSource: { kind: "tide_api", provider: "openai" },
    },
  });
  await runtime.writeInput(handle, {
    kind: "composer_input",
    value: "Keep calling tools",
    submittedAt: now,
  });

  assert.equal(executionCount, 1);
  assert.equal(client.inputs.length, 2);
  const lastFrame = frames.at(-1);
  assert.equal(lastFrame?.payload.type, "message");
  assert.equal(lastFrame?.payload.status, "failed");
  assert.match(lastFrame?.body ?? "", /tool-call limit/i);
});

test("openai_response_client_extracts_output_text_and_message_content", async () => {
  const requests: Array<{ url: string; init: Record<string, unknown> }> = [];
  const outputTextClient = createOpenAiResponsesClient({
    fetch: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        id: "resp-output-text",
        output_text: "from output_text",
      });
    },
  });

  const outputText = await outputTextClient.createResponse({
    account: { apiKey: "sk-test" },
    model: "gpt-5.5",
    input: "hello",
  });

  assert.equal(outputText.outputText, "from output_text");
  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal((requests[0].init.headers as Record<string, string>).Authorization, "Bearer sk-test");
  assert.equal(
    JSON.parse(String(requests[0].init.body)).model,
    "gpt-5.5",
  );

  const messageContentClient = createOpenAiResponsesClient({
    fetch: async () =>
      jsonResponse({
        id: "resp-message-content",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "from message content" }],
          },
        ],
      }),
  });

  const messageContent = await messageContentClient.createResponse({
    account: { apiKey: "sk-test", baseUrl: "https://example.test/v1" },
    model: "gpt-5.5",
    input: "hello",
  });

  assert.equal(messageContent.responseId, "resp-message-content");
  assert.equal(messageContent.outputText, "from message content");
});

test("openai_response_client_sends_tools_and_parses_function_calls", async () => {
  const requests: Array<{ url: string; init: Record<string, unknown> }> = [];
  const client = createOpenAiResponsesClient({
    fetch: async (url, init) => {
      requests.push({ url, init });
      return jsonResponse({
        id: "resp-tool-client",
        output: [
          { type: "reasoning", id: "reason-client", summary: [] },
          {
            type: "function_call",
            call_id: "call-client",
            name: "tide_observe_workbench",
            arguments: "{\"detail\":\"full\"}",
          },
        ],
      });
    },
  });

  const result = await client.createResponse({
    account: { apiKey: "sk-test" },
    model: "gpt-5.5",
    input: "observe",
    instructions: "Use Tide tools when useful.",
    previousResponseId: "resp-previous",
    tools: [
      {
        type: "function",
        name: "tide_observe_workbench",
        description: "Observe Workbench.",
        parameters: { type: "object", properties: { detail: { type: "string" } } },
        strict: false,
      },
    ],
  });

  const body = JSON.parse(String(requests[0].init.body));
  assert.equal(body.previous_response_id, "resp-previous");
  assert.equal(body.instructions, "Use Tide tools when useful.");
  assert.equal(body.tools[0].name, "tide_observe_workbench");
  assert.equal(result.functionCalls.length, 1);
  assert.deepEqual(result.functionCalls[0], {
    callId: "call-client",
    name: "tide_observe_workbench",
    argumentsJson: "{\"detail\":\"full\"}",
    raw: {
      type: "function_call",
      call_id: "call-client",
      name: "tide_observe_workbench",
      arguments: "{\"detail\":\"full\"}",
    },
  });
  assert.deepEqual(result.reasoningItems, [
    { type: "reasoning", id: "reason-client", summary: [] },
  ]);
});

class RecordingAgentRuntimePort implements AgentRuntimePort {
  readonly starts: AgentRuntimeStartInput[] = [];
  readonly resumes: AgentRuntimeResumeInput[] = [];
  readonly inputs: Array<{ handle: AgentRuntimeHandle; input: TerminalInput }> = [];
  readonly stops: AgentRuntimeHandle[] = [];
  private readonly runtimePrefix: string;

  constructor(runtimePrefix: string) {
    this.runtimePrefix = runtimePrefix;
  }

  async start(input: AgentRuntimeStartInput): Promise<AgentRuntimeHandle> {
    this.starts.push(input);
    return {
      runtimeId: `${this.runtimePrefix}-${this.starts.length}`,
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async resume(input: AgentRuntimeResumeInput): Promise<AgentRuntimeHandle> {
    this.resumes.push(input);
    return {
      runtimeId: `${this.runtimePrefix}-resume-${this.resumes.length}`,
      threadId: input.threadId,
      agentId: input.agentBinding.agentId,
    };
  }

  async writeInput(handle: AgentRuntimeHandle, input: TerminalInput): Promise<void> {
    this.inputs.push({ handle, input });
  }

  async stop(handle: AgentRuntimeHandle): Promise<void> {
    this.stops.push(handle);
  }
}

class RecordingReadinessPort implements ProviderReadinessPort {
  readonly inputs: ProviderReadinessCheckInput[] = [];
  private readonly result: ProviderReadinessResult;

  constructor(result: ProviderReadinessResult) {
    this.result = result;
  }

  async check(input: ProviderReadinessCheckInput): Promise<ProviderReadinessResult> {
    this.inputs.push(input);
    return this.result;
  }
}

class RecordingOpenAiResponseClient {
  readonly inputs: Array<{
    account: OpenAiProviderAccount;
    model: string;
    input: OpenAiResponseInput;
    tools?: OpenAiFunctionTool[];
    previousResponseId?: string;
    instructions?: string;
  }> = [];
  private readonly results: Array<{
    responseId?: string;
    outputText: string;
    raw: unknown;
    outputItems?: Array<Record<string, unknown>>;
    functionCalls?: OpenAiFunctionCall[];
    reasoningItems?: Array<Record<string, unknown>>;
  }>;

  constructor(
    result:
      | {
          responseId?: string;
          outputText: string;
          raw: unknown;
          outputItems?: Array<Record<string, unknown>>;
          functionCalls?: OpenAiFunctionCall[];
          reasoningItems?: Array<Record<string, unknown>>;
        }
      | Array<{
          responseId?: string;
          outputText: string;
          raw: unknown;
          outputItems?: Array<Record<string, unknown>>;
          functionCalls?: OpenAiFunctionCall[];
          reasoningItems?: Array<Record<string, unknown>>;
        }>,
  ) {
    this.results = Array.isArray(result) ? [...result] : [result];
  }

  async createResponse(input: {
    account: OpenAiProviderAccount;
    model: string;
    input: OpenAiResponseInput;
    tools?: OpenAiFunctionTool[];
    previousResponseId?: string;
    instructions?: string;
  }): Promise<{
    responseId?: string;
    outputText: string;
    raw: unknown;
    outputItems: Array<Record<string, unknown>>;
    functionCalls: OpenAiFunctionCall[];
    reasoningItems: Array<Record<string, unknown>>;
  }> {
    this.inputs.push(input);
    const result = this.results.shift();
    if (result === undefined) {
      throw new Error("RecordingOpenAiResponseClient ran out of results.");
    }
    return {
      responseId: result.responseId,
      outputText: result.outputText,
      raw: result.raw,
      outputItems: result.outputItems ?? [],
      functionCalls: result.functionCalls ?? [],
      reasoningItems: result.reasoningItems ?? [],
    };
  }
}

function toolCallResponse(responseId: string, callId: string) {
  const call: OpenAiFunctionCall = {
    callId,
    name: "tide_observe_thread",
    argumentsJson: "{}",
    raw: {
      type: "function_call",
      call_id: callId,
      name: "tide_observe_thread",
      arguments: "{}",
    },
  };
  return {
    responseId,
    outputText: "",
    raw: { id: responseId, output: [call.raw] },
    outputItems: [call.raw],
    functionCalls: [call],
    reasoningItems: [],
  };
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    async text(): Promise<string> {
      return JSON.stringify(body);
    },
  };
}

function sequentialIdGenerator(prefix: string): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `${prefix}-${index}`;
  };
}
